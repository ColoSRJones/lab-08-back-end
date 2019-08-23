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

app.get('/location', getLocation);
app.get('/events', getEvents);
app.get('/weather', getWeather);
app.get('/yelp', getYelps);
app.get('/movies', getMovies);

function convertTime(timeInMilliseconds) {
  return new Date(timeInMilliseconds).toString().slice(0, 15);
}

function Location(query,geoData) {
  this.search_query = query;
  this.formatted_query = geoData.results[0].formatted_address;
  this.latitude = geoData.results[0].geometry.location.lat;
  this.longitude = geoData.results[0].geometry.location.lng;
}

Location.prototype.save = function(){
	const SQL = 'INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id;';
	const VALUES = [this.search_query, this.formatted_query, this.latitude, this.longitude];

	return client.query(SQL, VALUES).then(result => {
		this.id = result.rows[0].id;
		return this;
	})
}

function Weather(weatherData) {
  this.location_id = weatherData.location_id;
  this.forecast = weatherData.summary;
  this.time = convertTime(weatherData.time * 1000);
}

function Event(query, url, name, date, summary) {
  this.search_query = query;
  this.link = url;
  this.name = name;
  this.event_date = date;
  this.summary = summary;
}

function handleError(error, response) {
  response.status(error.status || 500).send(error.message);
}

function lookupData(lookupHandler){
	const SQL = `SELECT * FROM ${lookupHandler.tableName} WHERE ${lookupHandler.column}=$1`
	const VALUES = [lookupHandler.query]

	client.query(SQL, VALUES).then(result => {
		if(result.rowCount === 0){
			lookupHandler.cacheMiss();
		} else {
			lookupHandler.cacheHit(result);
		}
	})
}

function getLocation(req, res){
	lookupData({
		tableName: 'locations',
		column: 'search_query',
		query: req.query.data,

		cacheHit: function (result) {
			res.send(result.rows[0]);
		},

		cacheMiss: function(){
			const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${this.query}&key=${process.env.GEOCODE_API_KEY}`;

			superagent.get(url)
				.then(geoData => {
					const location = new Location(this.query, geoData.body);
					location.save().then(location => res.send(location));
				})

		}
	
	})
}

function getWeather(req, res){

}

function getEvents(req, res){

}

function getYelps(req, res){

}

function getMovies(req, res){

}

// app.get('/location', (request, response) => {
//   const query = 'SELECT * FROM locations WHERE search_query=$1;';
//   const values = [request.query.data];

//   client.query(query, values).then(results => {
//     if (results.rows.length === 0) {
//       superagent
//         .get(`https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`)
//         .then((locationData) => {
//           const location = new Location(request.query.data, locationData.body.results[0].formatted_query, locationData.body.results[0].geometry.location.lat, locationData.body.results[0].geometry.location.lng);
//           const query = 'INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES ($1, $2, $3, $4)';
//           const values = Object.values(location);
//           client.query(query, values).catch((...args) => console.log(args));
//           response.send(location);
//         })
//         .catch((error) => handleError(error, response));
//     } else {
//       console.log(results.rows[0]);
//       response.send(new Location(request.query.data, results.rows[0].formatted_query, results.rows[0].latitude, results.rows[0].longitude));
//     }
//   }).catch(error => console.log(error));
// });

// app.get('/events', (request, response) => {

//   superagent
//     .get(`https://www.eventbriteapi.com/v3/events/search/?token=${process.env.EVENTBRITE_API_KEY}&location.latitude=${request.query.data.latitude}&location.longitude=${request.query.data.longitude}&location.within=10km`)
//     .then((eventData) => {
//       const sliceIndex = eventData.body.events.length > 20 ? 20 : eventData.body.events.length;
//       const events = eventData.body.events.slice(0, sliceIndex).map((event) => new Event(event));
//       response.send(events);
//     })
//     .catch((error) => handleError(error, response));
// });

// app.get('/weather', (request, response) => {
//   const query = 'SELECT * FROM weather WHERE latitude=$1 AND longitude=$2;';
//   const values = [request.query.data.latitude, request.query.data.longitude];
//   client.query(query, values).then(results => {
//     console.log(results.rowCount);
//     if (results.rows.length === 0) {
//       console.log('Here');
//       superagent
//         .get(`https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`)
//         .then((weatherData) => {
//           const weather = weatherData.body.daily.data.map((day) => new Weather(day));
//           const query = 'INSERT INTO weather (forecast, time, latitude, longitude) VALUES ($1, $2, $3, $4)';
//           weather.forEach(day => {
//             const values = [day.forecast, day.time, request.query.data.latitude, request.query.data.longitude];
//             client.query(query, values).catch((...args) => console.log(args));
//             });
//           response.send(weather);
//         })
//         .catch((error) => handleError(error, response));
//     } else {
//       console.log('There is error');
//     }
//   }).catch(error => console.log(error));
// }
// );

//   app.get(/.*/, (req, res) => {
//     res.status(404).send({ status: 404, responseText: 'This item could not be found..' });
//   });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('Server has started...');
  });
