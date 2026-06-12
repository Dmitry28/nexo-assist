import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { EnvironmentVariables } from '@/config/env.validation';

// Derived from the schema defaults — k8s probes target these exact paths.
const defaults = new EnvironmentVariables();
const PREFIX = `/${defaults.API_PREFIX}/v${defaults.API_VERSION}`;

describe('App (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Same pipeline as production (prefix, versioning, CORS, helmet).
    // ValidationPipe is wired globally via APP_PIPE in AppModule — no extra setup needed.
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it(`GET ${PREFIX}/health/live -> 200`, () => {
    return request(app.getHttpServer())
      .get(`${PREFIX}/health/live`)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('ok'));
  });

  it(`GET ${PREFIX}/health/ready -> 200`, () => {
    return request(app.getHttpServer())
      .get(`${PREFIX}/health/ready`)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('ok'));
  });

  it(`GET ${PREFIX}/metrics exposes Prometheus metrics`, () => {
    return request(app.getHttpServer())
      .get(`${PREFIX}/metrics`)
      .expect(200)
      .expect((res) => expect(res.text).toContain('process_cpu_seconds_total'));
  });

  it(`POST ${PREFIX}/users creates, GET ${PREFIX}/users/:id reads`, async () => {
    const create = await request(app.getHttpServer())
      .post(`${PREFIX}/users`)
      .send({ email: 'e2e@example.com', name: 'E2E User' })
      .expect(201);

    const { id } = create.body;
    expect(id).toBeDefined();

    await request(app.getHttpServer())
      .get(`${PREFIX}/users/${id}`)
      .expect(200)
      .expect((res) => expect(res.body.email).toBe('e2e@example.com'));
  });

  // Pins the explicit @Type() coercion path — implicit conversion is off in the pipe.
  it(`GET ${PREFIX}/users honors pagination query params`, () => {
    return request(app.getHttpServer())
      .get(`${PREFIX}/users?page=1&limit=5`)
      .expect(200)
      .expect((res) => expect(res.body.meta.limit).toBe(5));
  });

  it(`GET ${PREFIX}/users rejects a non-numeric limit`, () => {
    return request(app.getHttpServer()).get(`${PREFIX}/users?limit=abc`).expect(400);
  });

  it(`POST ${PREFIX}/users rejects invalid payloads`, () => {
    return request(app.getHttpServer())
      .post(`${PREFIX}/users`)
      .send({ email: 'not-an-email', name: 'x', extra: 'nope' })
      .expect(400);
  });
});
