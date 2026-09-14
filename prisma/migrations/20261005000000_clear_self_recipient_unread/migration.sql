-- Clear the unread badge for messages a person sent to themselves: a broadcast
-- to a group the sender belongs to (ALL_COACHES/ADMINS, a team, etc.) used to
-- include the sender as a recipient, giving them an unread in-app row for their
-- own message. dispatchMessage now excludes the sender; mark any existing such
-- rows read so the stuck counts clear.
UPDATE "MessageRecipient" mr
SET "readAt" = NOW(), "inAppStatus" = 'READ'
FROM "Message" m
JOIN "User" u ON u.id = m."senderId"
WHERE mr."messageId" = m.id
  AND u."personId" IS NOT NULL
  AND mr."personId" = u."personId"
  AND mr."readAt" IS NULL;
