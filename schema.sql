DROP TABLE IF EXISTS locations, weather, events, yelps, movies, trails;

CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  search_query VARCHAR(255),
  formatted_query VARCHAR(255),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7)
);

CREATE TABLE weather (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  forecast VARCHAR(255),
  time VARCHAR(255),
  created_at BIGINT

);

CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  search_query VARCHAR(255),
  link VARCHAR(255),
  name VARCHAR(255),
  event_date VARCHAR(255),
  summary VARCHAR,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  created_at BIGINT
);

CREATE TABLE yelps (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  image_url VARCHAR(255),
  price CHAR(5),
  rating NUMERIC(2,1),
  url VARCHAR(255),
  created_at BIGINT,
  location_id INTEGER NOT NULL REFERENCES locations(id)
);

CREATE TABLE movies (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255),
  overview VARCHAR(1000),
  average_votes NUMERIC(4,2),
  total_votes INTEGER,
  image_url VARCHAR(255),
  popularity NUMERIC(6,4),
  released_on CHAR(10),
  created_at BIGINT,
  location_id INTEGER NOT NULL REFERENCES locations(id)
);
CREATE TABLE trails (
  id SERIAL PRIMARY KEY,
  trail_url VARCHAR(2083),
  name VARCHAR(255),
  location VARCHAR(255),
  length NUMERIC(4, 1),
  condition_date VARCHAR(255),
  condition_time VARCHAR(255),
  conditions VARCHAR(255),
  stars NUMERIC(2, 1),
  star_votes INTEGER NOT NULL,
  summary VARCHAR(255),
  location_id INTEGER NOT NULL,
  FOREIGN KEY (location_id) REFERENCES locations (id)
);
