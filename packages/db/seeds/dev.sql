INSERT INTO users (id, username, password_hash)
VALUES (
  'user_default',
  'default',
  'pbkdf2$210000$BwcHBwcHBwcHBwcHBwcHBw$eGe992BahAiXcNXmASLTIQvGwljEjR_P7nBjsqguMEQ'
)
ON CONFLICT(id) DO NOTHING;
