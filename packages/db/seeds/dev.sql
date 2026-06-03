INSERT INTO users (id, username, password_hash)
VALUES (
  'user_default',
  'default',
  'pbkdf2$210000$QCgZUVErw7NU5g6dNefA_g$VdTtVZ9BI1-8MEp-47p3xQ1OmYFpdvNoQxCiPCjmkp4'
)
ON CONFLICT(id) DO NOTHING;
