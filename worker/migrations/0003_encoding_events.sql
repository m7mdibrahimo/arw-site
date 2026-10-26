-- the rented encoding machine's own events for the panel's bell (came on, went off, a show reached Drive, a step started)
CREATE TABLE IF NOT EXISTS enc_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS enc_events_at ON enc_events (at DESC);
