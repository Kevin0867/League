-- Normalized phone (last 10 digits) so search matches a number in any format.
ALTER TABLE "Person" ADD COLUMN "phoneDigits" TEXT;

-- Keep it current on every insert/update of phone via a trigger, so no app code
-- path can forget to set it.
CREATE OR REPLACE FUNCTION set_person_phone_digits() RETURNS trigger AS $$
BEGIN
  NEW."phoneDigits" := NULLIF(right(regexp_replace(coalesce(NEW."phone", ''), '[^0-9]', '', 'g'), 10), '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS person_phone_digits ON "Person";
CREATE TRIGGER person_phone_digits
  BEFORE INSERT OR UPDATE OF "phone" ON "Person"
  FOR EACH ROW EXECUTE FUNCTION set_person_phone_digits();

-- Backfill existing rows.
UPDATE "Person"
SET "phoneDigits" = NULLIF(right(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), 10), '')
WHERE "phone" IS NOT NULL;

CREATE INDEX "Person_phoneDigits_idx" ON "Person"("phoneDigits");
