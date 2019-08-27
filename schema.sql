DROP TABLE IF EXISTS locations, weather, events, yelps, movies, trails CASCADE;

CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  search_query VARCHAR(255),
  formatted_query VARCHAR(255),
  latitude NUMERIC(20, 14),
  longitude NUMERIC(20, 14),
  created_at BIGINT
);

CREATE TABLE weather (
  id SERIAL PRIMARY KEY,
  forecast VARCHAR(255),
  time VARCHAR (255),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  created_at BIGINT
);

CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  event_date VARCHAR(255),
  link VARCHAR(255),
  summary VARCHAR(10000),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  created_at BIGINT
);

CREATE TABLE yelps (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  image_url VARCHAR(1000),
  price CHAR(5),
  rating NUMERIC(2, 1),
  url VARCHAR(1000),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  created_at BIGINT
);

CREATE TABLE movies (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255),
  overview VARCHAR(5000),
  average_votes NUMERIC(8, 4),
  total_votes INTEGER,
  image_url VARCHAR(1000),
  popularity NUMERIC(8, 4),
  released_on CHAR(10),
  query VARCHAR(255) NOT NULL,
  created_at BIGINT
);

CREATE TABLE trails (
  id SERIAL PRIMARY KEY,
  created_at BIGINT,
  name VARCHAR(255),
  location VARCHAR(255),
  length FLOAT,
  stars FLOAT,
  star_votes INTEGER,
  summary VARCHAR(10000),
  trail_url VARCHAR(1000),
  conditions VARCHAR(500),
  condition_date VARCHAR(10),
  condition_time VARCHAR(10),
  location_id INTEGER NOT NULL REFERENCES locations(id)
);