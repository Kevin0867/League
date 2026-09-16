-- Try-before-you-pay signups: account + waiver, on a team to try a class, no
-- season fee charged until they convert.
ALTER TABLE "Registration" ADD COLUMN "trial" BOOLEAN NOT NULL DEFAULT false;
