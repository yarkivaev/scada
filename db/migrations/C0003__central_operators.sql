CREATE TABLE IF NOT EXISTS operators (
    id SERIAL PRIMARY KEY,
    card_uid TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    display_name TEXT NOT NULL
);
