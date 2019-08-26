/* eslint-disable camelcase */
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

const timeouts = {
  weather: 3600000,
  yelp: 86400000,
  events: 86400000,
  movies: 86400000,
};

app.get('/location', getLocation);
app.get('/events', getEvents);
app.get('/weather', getWeather);
app.get('/yelp', getYelps);
app.get('/movies', getMovies);

function convertTime(timeInMilliseconds) {
  return new Date(timeInMilliseconds).toString().slice(0, 15);
}

function handleError(error, response) {
  response.status(error.status || 500).send(error.message);
}

function lookupData(lookupHandler){
  const SQL = `SELECT * FROM ${lookupHandler.tableName} WHERE ${lookupHandler.column}=$1;`;
  const VALUES = [lookupHandler.query];

  client.query(SQL, VALUES).then(result => {
    if(result.rowCount === 0) {
      lookupHandler.cacheMiss();
    }
    else {
      lookupHandler.cacheHit(result);
    }
  });
}

function deleteData(tableName, location_id) {
  const SQL = `DELETE FROM ${tableName} WHERE location_id=$1;`;
  const VALUES = [location_id];
  return client.query(SQL, VALUES);
}

function Location(query, geoData) {
  this.search_query = query;
  this.formatted_query = geoData.results[0].formatted_address;
  this.latitude = geoData.results[0].geometry.location.lat;
  this.longitude = geoData.results[0].geometry.location.lng;
}

Location.prototype.save = function(){
  const SQL = `INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id;`;
  const VALUES = [this.search_query, this.formatted_query, this.latitude, this.longitude];

  return client.query(SQL, VALUES).then(result => {
    this.id = result.rows[0].id;
    return this;
  });
};

function Weather(weatherData) {
  this.created_at = Date.now();
  this.forecast = weatherData.summary;
  this.time = convertTime(weatherData.time * 1000);
}

Weather.prototype.save = function(location_id) {
  const SQL = `INSERT INTO weather (forecast, time, created_at, location_id) VALUES($1, $2, $3, $4);`;
  const VALUES = [this.forecast, this.time, this.created_at, location_id];

  client.query(SQL, VALUES);
};

function Event(eventData) {
  this.created_at = Date.now();
  this.link = eventData.url;
  this.name = eventData.name.text;
  this.event_date = eventData.start.local;
  this.summary = eventData.description.text;
}

Event.prototype.save = function(location_id) {
  const SQL = `INSERT INTO events (link, name, event_date, summary, location_id, created_at) VALUES($1, $2, $3, $4, $5, $6);`;
  const VALUES = [this.link, this.name, this.event_date, this.summary, location_id, this.created_at];

  client.query(SQL, VALUES);
};

function Yelp(yelpData) {
  this.name = yelpData.name;
  this.image_url = yelpData.image_url;
  this.price = yelpData.price;
  this.rating = yelpData.rating;
  this.url = yelpData.url;
  this.created_at = Date.now();
}

Yelp.prototype.save = function(location_id) {
  const SQL = `INSERT INTO yelps (name, image_url, price, rating, url, created_at, location_id) VALUES($1, $2, $3, $4, $5, $6, $7);`;
  const VALUES = [this.name, this.image_url, this.price, this.rating, this.url, this.created_at, location_id];

  client.query(SQL, VALUES);
};

function Movie(movieData) {
  this.created_at = Date.now();
  this.title = movieData.title;
  this.overview = movieData.overview;
  this.average_votes = movieData.vote_average;
  this.total_votes = movieData.vote_count;
  this.image_url = `https://image.tmdb.org/t/p/w185_and_h278_bestv2/${movieData.poster_path}`;
  this.popularity = movieData.popularity;
  this.released_on = movieData.release_date;
}

Movie.prototype.save = function(location_id) {
  const SQL = `INSERT INTO movies (created_at, title, overview, average_votes, total_votes, image_url, popularity, released_on, location_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9);`;
  const VALUES = [this.created_at, this.title, this.overview, this.average_votes, this.total_votes, this.image_url, this.popularity, this.released_on, location_id];

  client.query(SQL, VALUES);
};

function getLocation(req, res){
  lookupData({
    tableName: 'locations',
    column: 'search_query',
    query: req.query.data,

    cacheHit: function (result) {
      res.send(result.rows[0]);
    },

    cacheMiss: function() {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${this.query}&key=${process.env.GEOCODE_API_KEY}`;

      superagent.get(url)
        .then(geoData => {
          const location = new Location(this.query, geoData.body);
          location.save().then(location => res.send(location));
        });
    }
  });
}

function getWeather(req, res){
  lookupData({
    tableName: 'weather',
    column: 'location_id',
    query: req.query.data.id,

    cacheHit: function(result) {
      let ageOfResults = (Date.now() - result.rows[0].created_at);
      if(ageOfResults > timeouts.weather){
        deleteData('weather', req.query.data.id).then(() => {
          this.cacheMiss();
        });
      } else {
        res.send(result.rows);
      }
    },

    cacheMiss: function() {
      const url = `https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${req.query.data.latitude},${req.query.data.longitude}`;

      superagent.get(url)
        .then(weatherData => {
          const weatherSummaries = weatherData.body.daily.data.map(day => {
            const summary = new Weather(day);
            summary.save(req.query.data.id);
            return summary;
          });
          res.send(weatherSummaries);
        });
    },
  });
}

function getEvents(req, res){
  lookupData({
    tableName: 'events',
    column: 'location_id',
    query: req.query.data.id,

    cacheHit: function(result) {
      let ageOfResults = (Date.now() - result.rows[0].created_at);
      if(ageOfResults > timeouts.events){
        deleteData('events', req.query.data.id).then(() => {
          this.cacheMiss();
        });
      } else {
        res.send(result.rows);
      }
    },

    cacheMiss: function() {

			//For some reason eventbrite doesn't like you api key. I dont know why.
			//Try getting a new key
      const url = `https://www.eventbriteapi.com/v3/events/search/?token=${process.env.EVENTBRITE_API_KEY}&location.latitude=${request.query.data.latitude}&location.longitude=${request.query.data.longitude}&location.within=10km`;

      superagent.get(url)
        .then(eventData => {
          const sliceIndex = eventData.body.events.length > 20 ? 20 : eventData.body.events.length;
          const eventSummaries = eventData.body.events.slice(0, sliceIndex).map(event => {
            const summary = new Event(event);
            summary.save(req.query.data.id);
            return summary;
          });
          res.send(eventSummaries);
        });
    },
  });
}

function getYelps(req, res){
  lookupData({
    tableName: 'yelps',
    column: 'location_id',
    query: req.query.data.id,

    cacheHit: function(result) {
      let ageOfResults = (Date.now() - result.rows[0].created_at);
      if(ageOfResults > timeouts.events){
        deleteData('yelps', req.query.data.id).then(() => {
          this.cacheMiss();
        });
      } else {
        res.send(result.rows);
      }
    },

    cacheMiss: function() {
      const url = `https://api.yelp.com/v3/businesses/search?location=${req.query.data.search_query}`;

      superagent.get(url)
        .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
        .then(yelpData => {
          const sliceIndex = yelpData.body.businesses.length > 20 ? 20 : yelpData.body.businesses.length;
          const yelpSummary = yelpData.body.businesses.slice(0, sliceIndex).map(business => {
            const summary = new Yelp(business);
            summary.save(req.query.data.id);
            return summary;
          });
          res.send(yelpSummary);
        });
    },
  });
}

function getMovies(req, res){
  lookupData({
    tableName: 'movies',
    column: 'location_id',
    query: req.query.data.id,

    cacheHit: function(result) {
      let ageOfResults = (Date.now() - result.rows[0].created_at);
      if(ageOfResults > timeouts.events){
        deleteData('movies', req.query.data.id).then(() => {
          this.cacheMiss();
        });
      } else {
        res.send(result.rows);
      }
    },

    cacheMiss: function() {
      const url = `https://api.themoviedb.org/3/search/movie/?api_key=${process.env.MOVIE_API_KEY}&language=en-US&page=1&query=${req.query.data.search_query}`;

      superagent.get(url)
        .then(movieData => {
          const sliceIndex = movieData.body.results > 20 ? 20 : movieData.body.results.length;
          const movies = movieData.body.results.slice(0, sliceIndex).map(movie => {
            const summary = new Movie(movie);
            summary.save(req.query.data.id);
            return summary;
          });
          res.send(movies);
        });
    },
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Serving is listening..');
});