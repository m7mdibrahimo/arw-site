-- The owner's rented encoding machine (reports/سيرفر-التفريغ): its latest heartbeat and every finished step,
-- for the panel's «سيرفر التفريغ» page.
CREATE TABLE IF NOT EXISTS enc_status (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS enc_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  step TEXT NOT NULL,
  started INTEGER NOT NULL,
  finished INTEGER NOT NULL,
  ok INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS enc_jobs_finished ON enc_jobs (finished DESC);
-- what the panel asks the machine to do (a link to fetch, an Arabic subtitle to merge, a show to clear); the machine
-- picks them up with its next heartbeat
CREATE TABLE IF NOT EXISTS enc_cmds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  created INTEGER NOT NULL,
  taken INTEGER NOT NULL DEFAULT 0
);
