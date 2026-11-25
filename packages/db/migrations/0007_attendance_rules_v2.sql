CREATE TABLE shift_templates_new(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  in_from_min INTEGER NOT NULL,
  in_to_min INTEGER NOT NULL,
  out_from_min INTEGER NOT NULL,
  out_to_min INTEGER,
  late_grace_min INTEGER NOT NULL DEFAULT 0,
  checkout_open_before_end_min INTEGER NOT NULL DEFAULT 10,
  ot_cap_min INTEGER NOT NULL DEFAULT 480,
  CHECK(end_min > start_min AND in_from_min <= in_to_min),
  CHECK(out_to_min IS NULL OR out_from_min <= out_to_min),
  CHECK(late_grace_min >= 0),
  CHECK(checkout_open_before_end_min >= 0),
  CHECK(ot_cap_min >= 0)
);

INSERT INTO shift_templates_new(
  id,name,active,start_min,end_min,in_from_min,in_to_min,out_from_min,out_to_min,
  late_grace_min,checkout_open_before_end_min,ot_cap_min
)
SELECT id,name,active,start_min,end_min,in_from_min,in_to_min,out_from_min,out_to_min,0,10,480
FROM shift_templates;

DROP TABLE shift_templates;
ALTER TABLE shift_templates_new RENAME TO shift_templates;

INSERT INTO schema_version(version,applied_at) VALUES(7,CURRENT_TIMESTAMP);
