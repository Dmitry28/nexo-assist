import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '@/app.module';

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live -> 200', () => {
    return request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('ok'));
  });

  it('GET /health/ready -> 200', () => {
    return request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('ok'));
  });

  it('GET /metrics exposes Prometheus metrics', () => {
    return request(app.getHttpServer())
      .get('/metrics')
      .expect(200)
      .expect((res) => expect(res.text).toContain('process_cpu_seconds_total'));
  });

  it('POST /users creates, GET /users/:id reads', async () => {
    const create = await request(app.getHttpServer())
      .post('/users')
      .send({ email: 'e2e@example.com', name: 'E2E User' })
      .expect(201);

    const { id } = create.body;
    expect(id).toBeDefined();

    await request(app.getHttpServer())
      .get(`/users/${id}`)
      .expect(200)
      .expect((res) => expect(res.body.email).toBe('e2e@example.com'));
  });

  it('POST /users rejects invalid payloads', () => {
    return request(app.getHttpServer())
      .post('/users')
      .send({ email: 'not-an-email', name: 'x', extra: 'nope' })
      .expect(400);
  });
});
