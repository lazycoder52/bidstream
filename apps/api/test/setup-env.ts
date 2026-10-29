process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3001';
process.env['DATABASE_URL'] =
  'postgresql://bidstream:bidstream_pass@localhost:5432/bidstream_db?schema=public';
process.env['REDIS_HOST'] = 'localhost';
process.env['REDIS_PORT'] = '6379';
process.env['JWT_ACCESS_SECRET'] =
  'change_this_to_a_secure_random_string_at_least_32_characters_long';
process.env['JWT_REFRESH_SECRET'] = 'change_this_to_another_secure_random_string_at_least_32_chars';
process.env['JWT_ACCESS_EXPIRES_IN'] = '15m';
process.env['JWT_REFRESH_EXPIRES_IN'] = '7d';
process.env['CORS_ORIGIN'] = 'http://localhost:5173';
process.env['THROTTLE_TTL'] = '60';
process.env['THROTTLE_LIMIT'] = '120';
