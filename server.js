(() => {
  'use strict';
  const express = require('express');
  const cors = require('cors');
  require('dotenv').config();
  const superagent = require('superagent');
  const pg = require('pg');

  const client = new pg.Client(process.env.DATABASE_URL);
  client.connect();

  const app = express();
  app.use(cors());

  const CACHE_MAX_AGE = {
    WEATHER: 60000,
    EVENTS: 60000,
    MOVIES: 60000,
    YELPS: 60000,
    TRAILS: 60000
  };

  function convertTime(timeInMilliseconds) {
    return new Date(timeInMilliseconds).toString().split(' ').slice(0, 4).join(' ');
  }

  function handleError(error, response) {
    response.status(error.status || 500).send(error.message);
  }

  function getErrorHandler(response) {
    return (error) => handleError(error, response);
  }

  //Major functionality...

  /*
    Check out these functional APIs!
    They're nested to all hell, but meh. It'd be even longer without the nesting.
    Would be neat to actually discuss how to build functional APIs like this, so that I'm not
    just taking shots in the dark at the format.
  */
  function when(path) {
    return {
      selectFrom: function (table) {
        return {
          where: function (...columns) {
            let sql = `SELECT * FROM ${table} WHERE `;
            columns.forEach((column, index) => {
              sql += `${column}=$${index + 1}`;
              if (index + 1 < columns.length) {
                sql += ' AND ';
              }
            });
            sql += ';';
            return {
              are: function (...values) {
                return {
                  then: function (onHit) {
                    return {
                      else: function (onMiss) {
                        app
                          .get(path, (request, response) => {
                            let currValues = typeof values[0] === 'function' ? values[0](request) : values;
                            if (!Array.isArray(currValues)) {
                              currValues = [currValues];
                            }
                            client
                              .query(sql, currValues)
                              .then(recieved => {
                                if (recieved.rows.length === 0) {
                                  onMiss(request, response);
                                } else {
                                  onHit(recieved, response, request);
                                }
                              })
                              .catch(getErrorHandler(response));
                          });
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
    };
  }

  function onHit() {
    return {
      ifOlderThan: function (maxAge) {
        this.maxAge = maxAge;
        const outer = this;
        return {
          deleteFrom: function (table) {
            outer.table = table;
            return {
              where: function (...columns) {
                outer.sql = `DELETE FROM ${outer.table} WHERE `;
                columns.forEach((column, index) => {
                  outer.sql += `${column}=$${index + 1}`;
                  if (index + 1 < columns.length) {
                    outer.sql += ' AND ';
                  }
                });
                outer.sql += ';';
                return {
                  are: function (...values) {
                    outer.values = values;
                    return {
                      then: function (callback) {
                        outer.onMiss = callback;
                        return outer;
                      }
                    };
                  }
                };
              }
            };
          }
        };
      },
      send: function (rowIndex) {
        const context = this;
        return function (results, response, request) {
          if (context.maxAge && Number(results.rows[0].created_at) + context.maxAge < Date.now()) {
            let values = typeof context.values[0] === 'function' ? context.values[0](request) : context.values;
            if (!Array.isArray(values)) {
              values = [values];
            }
            console.log(`Clearing ${context.table} cache...`);
            client.query(context.sql, values)
              .then(() => context.onMiss(request, response))
              .catch(getErrorHandler(response));
          } else if (rowIndex !== undefined) {
            response.send(results.rows[rowIndex]);
          } else {
            response.send(results.rows);
          }
        };
      }
    };
  }

  function onMiss() {
    return {
      getUrlForRequest: function (urlBuilder) {
        const headers = [];
        return {
          set: function (header, value) {
            headers.push({ header: header, value: value });
            return this;
          },
          then: function (responseParser) {
            return function (request, response) {
              const url = urlBuilder(request).replace(' ', '%20');
              const pending = superagent.get(url);
              headers.forEach(header => pending.set(header.header, header.value));
              pending.then(responseData => {
                const parsed = responseParser(responseData, request);
                if (Array.isArray(parsed)) {
                  parsed.forEach(result => result.save());
                  response.send(parsed);
                } else {
                  parsed.save().then((newVal) => response.send(newVal));
                }
              })
                .catch(getErrorHandler(response));
            };
          }
        };
      }
    };
  }

  const insertInto = (table, object, extra, onResults) => {
    const columns = [...Object.keys(object), 'created_at'];
    const values = [...Object.values(object), Date.now()];
    let valueReplacer = '$1';
    for (let i = 1; i < values.length; i++) {
      valueReplacer += `, $${i + 1}`;
    }
    let sql = `INSERT INTO ${table} (${columns}) VALUES(${valueReplacer}) ON CONFLICT DO NOTHING`;
    if (extra) {
      sql += ` ${extra}`;
    }
    sql = `${sql};`;
    const pending = client.query(sql, values).catch(error => {
      console.log(`We seem to have encountered a bug: ${error}`);
      console.log(values);
    });
    if (onResults) {
      return pending.then(onResults);
    }
    return pending;
  };

  //Constructors

  function Location(query, formatted, lat, long) {
    this.search_query = query;
    this.formatted_query = formatted;
    this.latitude = lat;
    this.longitude = long;
  }

  Location.prototype.save = function () {
    return insertInto('locations', this, 'RETURNING id', result => {
      this.id = result.rows[0].id;
      return this;
    });
  };

  function Weather(locationId, weatherData) {
    this.location_id = locationId;
    this.forecast = weatherData.summary || weatherData.forecast;
    this.time = isNaN(weatherData.time) ? weatherData.time : convertTime(weatherData.time * 1000);
  }

  Weather.prototype.save = function () {
    insertInto('weather', this);
  };

  function Event(locationId, eventData) {
    this.location_id = locationId;
    this.link = eventData.url || eventData.link;
    this.name = eventData.name.text ? eventData.name.text : eventData.name;
    this.event_date = eventData.start ? eventData.start.local : eventData.event_date;
    this.summary = eventData.description ? eventData.description.text : eventData.summary;
    if (this.summary && this.summary.length > 10000) {
      this.summary = `${this.summary.slice(0, 9997)}...`;
    }
  }

  Event.prototype.save = function () {
    insertInto('events', this);
  };

  function YelpLocation(locationId, yelpData) {
    this.location_id = locationId;
    this.name = yelpData.name;
    this.image_url = yelpData.image_url;
    this.price = yelpData.price;
    this.rating = yelpData.rating;
    this.url = yelpData.url;
  }

  YelpLocation.prototype.save = function () {
    insertInto('yelps', this);
  };

  function Movie(query, movieData) {
    this.query = query;
    this.title = movieData.title;
    this.overview = movieData.overview;
    this.average_votes = movieData.vote_average;
    this.total_votes = movieData.vote_count;
    this.image_url = `https://image.tmdb.org/t/p/w185_and_h278_bestv2${movieData.poster_path}`;
    this.popularity = movieData.popularity;
    this.released_on = movieData.release_date;
  }

  Movie.prototype.save = function () {
    insertInto('movies', this);
  };

  function Trail(locationId, trailData) {
    this.location_id = locationId;
    this.name = trailData.name;
    this.location = trailData.location;
    this.length = trailData.length;
    this.stars = trailData.stars;
    this.star_votes = trailData.starVotes;
    this.summary = trailData.summary;
    this.trail_url = trailData.url;
    this.conditions = `${trailData.conditionStatus}: ${trailData.conditionDetails}`;
    const splitDate = trailData.conditionDate.split(' ');
    this.condition_date = splitDate[0];
    this.condition_time = splitDate[1];
  }

  Trail.prototype.save = function () {
    insertInto('trails', this);
  };

  // Cache hit/miss functions
  // Note that there is most definitely a way to get these onMiss/onHits to fit inside their "when" declarations.
  // The only problem, currently, is that it's hard to reference the "onMiss" inside of "onHit", if they are declared inside of "when"
  // A solution I was attempting was to bind onMiss and onHit to the "this" of the "when", and then they could reference eachother through
  // this.onHit and this.onMiss, but this would require yet another callback as they are not bound until after when...else.

  const onLocationMiss = onMiss()
    .getUrlForRequest(request => `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`)
    .then((response, request) => new Location(request.query.data, response.body.results[0].formatted_address, response.body.results[0].geometry.location.lat, response.body.results[0].geometry.location.lng));

  const onLocationHit = onHit().send(0);

  const onWeatherMiss = onMiss()
    .getUrlForRequest(request => `https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`)
    .then((response, request) => response.body.daily.data.map(day => new Weather(request.query.data.id, day)));

  const onWeatherHit = onHit().ifOlderThan(CACHE_MAX_AGE.WEATHER).deleteFrom('weather').where('location_id').are((request) => request.query.data.id)
    .then(onWeatherMiss).send();

  const onEventsMiss = onMiss()
    .getUrlForRequest(request => `https://www.eventbriteapi.com/v3/events/search/?token=${process.env.EVENTBRITE_API_KEY}&location.latitude=${request.query.data.latitude}&location.longitude=${request.query.data.longitude}&location.within=10km`)
    .then((response, request) => {
      const sliceIndex = response.body.events.length > 20 ? 20 : response.body.events.length;
      const events = response.body.events.slice(0, sliceIndex).map(event => new Event(request.query.data.id, event));
      return events;
    });

  const onEventsHit = onHit().ifOlderThan(CACHE_MAX_AGE.EVENTS).deleteFrom('events').where('location_id').are((request) => request.query.data.id)
    .then(onEventsMiss).send();

  const onMoviesMiss = onMiss()
    .getUrlForRequest(request => `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIEDB_API_KEY}&language=en-US&page=1&query=${request.query.data.search_query}`)
    .then((response, request) => response.body.results.map(movie => new Movie(request.query.data.search_query, movie)));

  const onMoviesHit = onHit().ifOlderThan(CACHE_MAX_AGE.MOVIES).deleteFrom('movies').where('query').are((request) => request.query.data.search_query)
    .then(onMoviesMiss).send();

  const onYelpMiss = onMiss()
    .getUrlForRequest((request) => `https://api.yelp.com/v3/businesses/search?latitude=${request.query.data.latitude}&longitude=${request.query.data.longitude}`)
    .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
    .then((response, request) => response.body.businesses.map(business => new YelpLocation(request.query.data.id, business)));

  const onYelpHit = onHit().ifOlderThan(CACHE_MAX_AGE.YELPS).deleteFrom('yelps').where('location_id').are((request) => request.query.data.id)
    .then(onYelpMiss).send();

  const onTrailsMiss = onMiss()
    .getUrlForRequest(request => `https://www.hikingproject.com/data/get-trails?lat=${request.query.data.latitude}&lon=${request.query.data.longitude}&maxDistance=10&key=${process.env.TRAILS_API_KEY}`)
    .then((response, request) => response.body.trails.map(trail => new Trail(request.query.data.id, trail)));

  const onTrailsHit = onHit().ifOlderThan(CACHE_MAX_AGE.TRAILS).deleteFrom('trails').where('location_id').are((request) => request.query.data.id)
    .then(onTrailsMiss).send();

  //Routes

  when('/location').selectFrom('locations').where('search_query').are((request) => request.query.data)
    .then(onLocationHit)
    .else(onLocationMiss);

  when('/weather').selectFrom('weather').where('location_id').are((request) => request.query.data.id)
    .then(onWeatherHit)
    .else(onWeatherMiss);

  when('/events').selectFrom('events').where('location_id').are((request) => request.query.data.id)
    .then(onEventsHit)
    .else(onEventsMiss);

  when('/movies').selectFrom('movies').where('query').are((request) => request.query.data.search_query)
    .then(onMoviesHit)
    .else(onMoviesMiss);

  when('/yelp').selectFrom('yelps').where('location_id').are((request) => request.query.data.id)
    .then(onYelpHit)
    .else(onYelpMiss);

  when('/trails').selectFrom('trails').where('location_id').are((request) => request.query.data.id)
    .then(onTrailsHit)
    .else(onTrailsMiss);

  app.get('*', (req, res) => {
    res.status(404).send({ status: 404, responseText: 'This item could not be found...' });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Listening for requests on port: ${PORT}`);
  });
})();