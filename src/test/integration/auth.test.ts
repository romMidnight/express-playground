import ms from 'ms';
import supertest from 'supertest';
import app from '../../app';
import { connect, close, User, Provider, getManager } from '../../db';
import { googleAuth, googleAuthCallback } from '../../auth/google';
import env from '../../env';
import { sleep } from '../../utils';

const testUser = {
  id: 1,
  email: 'test@gmail.com',
};

jest.mock('../../auth/google', () => ({
  googleAuth: jest.fn((_req, _res, next) => {
    next();
  }),
  googleAuthCallback: jest.fn((req, _res, next) => {
    const testProvider = new Provider();
    testProvider.provider = 'test';
    testProvider.providerId = '123';
    testProvider.email = testUser.email;
    testProvider.accessToken = 'testAccess';

    req.user = testProvider;
    next();
  }),
}));

jest.mock('../../env', () => ({
  DB_URL: 'postgresql://rem@localhost:5432/midnightest',
  COOKIE_MAX_AGE: '1d',
  TOKEN_MAX_AGE: '100ms',
  TOKEN_SECRET: 'Password string too short (min 32 characters required)',
}));

describe('Auth API', () => {
  let req: ReturnType<typeof supertest>;
  let agent: ReturnType<typeof supertest.agent>;

  beforeAll(async () => {
    await connect();
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    req = supertest(app);
    agent = supertest.agent(app);

    await getManager().delete(Provider, {});
    await getManager().delete(User, {});
  });

  it('/secret should return 401 without auth', async () => {
    const res = await req.get('/secret');

    expect(res.status).toBe(401);
  });

  it('/auth/google should invoke googleAuth middleware', async () => {
    await req.get('/auth/google');

    expect(googleAuth).toHaveBeenCalled();
  });

  it('/auth/google/callback should set cookie and redirect', async () => {
    const res = await req.get('/auth/google/callback');

    expect(res.status).toBe(302);
    expect(googleAuthCallback).toHaveBeenCalled();
    expect(res.header['set-cookie'][0]).toContain('sid');
    expect(res.header['set-cookie'][0]).toContain('HttpOnly');
  });

  it('/secret should accept cookies', async () => {
    await agent.get('/auth/google/callback');

    const res = await agent.get('/secret');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: testUser.email });
  });

  it('/secret should accept Authorization header', async () => {
    let res = await req.get('/auth/google/callback');

    const rawCookie = res.header['set-cookie'][0];

    const token = rawCookie.substring(
      rawCookie.indexOf('=') + 1,
      rawCookie.indexOf(';')
    );

    res = await req.get('/secret').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: testUser.email });
  });

  it('/logout should clear cookie', async () => {
    await agent.get('/auth/google/callback');
    await agent.get('/logout');

    const res = await agent.get('/secret');

    expect(res.status).toBe(401);
  });

  it('/secret should return 401 after token expires', async () => {
    await agent.get('/auth/google/callback');

    await sleep(ms(env.TOKEN_MAX_AGE));

    const res = await agent.get('/secret');

    expect(res.status).toBe(401);

    expect(res.text).toBe('Token expired');
  });
});
