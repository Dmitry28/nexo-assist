# Deploy & DevOps — учебный гайд

Практический разбор деплоя nexo-assist с объяснением концепций (DevOps впервые).
На каждом шаге: **что** сделали, **зачем**, и **концепт простыми словами** + ссылки.
Высокоуровневый план — в [PRODUCT_PLAN.md §Фаза 5](PRODUCT_PLAN.md); здесь — «почему так».

## Куда деплоим (решено)

- **Приложение:** наш Docker-образ → **k3s** (лёгкий Kubernetes) на бесплатной VM
  **Oracle Cloud Always Free**. Настоящий k8s → максимум DevOps-опыта.
- **База:** **Neon** — managed Postgres (free tier). Бэкапы/аптайм — на их стороне.
- **Портируемо:** апп = образ, БД = строка `DATABASE_URL`. Переезд (напр. на Hetzner
  ~€4.5/мес) — смена таргета, не переписывание.

## Как код попадает в прод (общая картина)

```
код → docker build → образ → push в registry (GHCR) → k8s тянет образ → запускает Pod
                                                         ↑
                                     манифесты (Kustomize) описывают ЧТО запускать
```

1. **Собираем образ** (Dockerfile) — самодостаточный «архив» приложения.
2. **Кладём в registry** (GitHub Container Registry) — склад образов, откуда кластер качает.
3. **Кластер применяет манифесты** (`kubectl apply -k k8s/`) — декларативно: ты
   описываешь _желаемое состояние_, k8s его достигает и поддерживает.

## Концепции простыми словами

- **Container / образ (image):** упакованное приложение + его зависимости. Образ —
  «слепок» (read-only), контейнер — запущенный экземпляр. У нас образ строит
  многостадийный [`Dockerfile`](../Dockerfile) (build → prune dev-deps → тонкий runtime).
- **Kubernetes (k8s):** система, которая запускает контейнеры, перезапускает упавшие,
  следит за здоровьем, обновляет без простоя. **k3s** — его лёгкая версия для одной
  небольшой VM.
- **Pod** — минимальная единица запуска: один (или несколько) контейнеров вместе. Наш
  Pod = бот (+ initContainer миграций, см. ниже).
- **Deployment** — «хочу N одинаковых Pod'ов такой-то версии». Держит их живыми,
  катит обновления. У нас `replicas: 1` (бот на long-polling — singleton: один поллер
  на токен, иначе Telegram шлёт 409).
- **Service** — стабильный внутренний адрес к Pod'ам (они эфемерны, IP меняются).
- **ConfigMap vs Secret** — конфиг через env-переменные. Несекретное (порты, cron) →
  **ConfigMap**; секреты (токен бота, пароль БД в `DATABASE_URL`) → **Secret**
  (не коммитим в репо!).
- **initContainer** — контейнер, который отрабатывает **до** основного и должен
  успешно завершиться. Идеален для миграций БД: применили схему → только потом
  стартует апп.
- **Probes (пробы):** k8s спрашивает приложение о здоровье. _liveness_ — «живой?»
  (нет → перезапуск); _readiness_ — «готов принимать трафик?» (нет → убирают из
  Service); _startup_ — даёт время на медленный старт.
- **Kustomize** — накладывает манифесты без шаблонов (в отличие от Helm). `kubectl -k`
  умеет это из коробки. Наш [`k8s/kustomization.yaml`](../k8s/kustomization.yaml)
  собирает configmap + deployment + service.
- **Registry (GHCR)** — хранилище образов. CD пушит туда `nexo-assist:<sha>` и
  прописывает этот тег в деплой.

## Наши файлы

| Файл                                                  | Что описывает                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| [`Dockerfile`](../Dockerfile)                         | как собрать образ (multi-stage, non-root, healthcheck)                  |
| [`k8s/deployment.yaml`](../k8s/deployment.yaml)       | Pod: initContainer миграций + контейнер бота, пробы, лимиты, hardening  |
| [`k8s/configmap.yaml`](../k8s/configmap.yaml)         | несекретные env                                                         |
| [`k8s/service.yaml`](../k8s/service.yaml)             | внутренний адрес                                                        |
| [`k8s/kustomization.yaml`](../k8s/kustomization.yaml) | что собрать вместе                                                      |
| Secret `nexo-assist-secrets`                          | `TELEGRAM_BOT_TOKEN` + `DATABASE_URL` (создаётся в кластере, не в репо) |

## Шаги (лог с пояснениями)

### Шаг 1 — миграции, работающие и локально, и в контейнере

**Проблема:** миграции запускались только через `ts-node` по исходникам `src/`. В
рантайм-образе нет ни `ts-node`, ни `src/` (только компилированный `dist/`) → в проде
не прогнались бы.

**Решение:** один `data-source.ts`, который сам определяет по расширению своего файла,
где он запущен — `.ts` (локально, ts-node, `src/`) или `.js` (в контейнере, node,
`dist/`). Убрали dev-зависимость `dotenv` из него (в проде env приходит из окружения
пода). Добавили prod-скрипт `migration:run:prod` (чистый `node`, без ts-node).

**Концепт — почему миграции отдельно от кода:** схема БД версионируется миграциями
(каждая — один необратимый шаг), а `synchronize` в проде запрещён (он молча меняет
схему). Так изменения БД предсказуемы и повторяемы.

### Шаг 2 — миграции при деплое (initContainer) + секреты

**Что:** в Deployment добавлен initContainer `migrate` — тот же образ, гоняет
`migration:run:prod` до старта бота. Упал → Pod не поднимется (не работаем на битой
схеме). `DATABASE_URL` кладётся в Secret (в нём пароль Neon), а не в ConfigMap.

**Концепт — почему initContainer, а не «внутри приложения»:** миграции отделены от
рантайма — приложение не должно менять схему при каждом старте (гонки при нескольких
репликах, права). initContainer прогоняет их один раз, атомарно, до апп-контейнера.
Идемпотентно: TypeORM хранит применённые миграции в таблице и пропускает их повторно.

**Концепт — ConfigMap vs Secret:** `DATABASE_URL` содержит пароль → это секрет.
Secret в кластере не коммитится; для GitOps используют sealed-secrets / external-secrets
оператор или секрет-менеджер платформы.

## Полезные команды

```bash
# Отрендерить итоговые манифесты (что реально уедет в кластер):
kubectl kustomize k8s/

# Проверить манифесты без применения (клиентская валидация):
kubectl apply --dry-run=client -k k8s/

# Создать секрет (пример — реальные значения не коммитить):
kubectl create secret generic nexo-assist-secrets \
  --from-literal=TELEGRAM_BOT_TOKEN='...' --from-literal=DATABASE_URL='...'
```

## Ссылки

- Kubernetes concepts: https://kubernetes.io/docs/concepts/
- initContainers: https://kubernetes.io/docs/concepts/workloads/pods/init-containers/
- ConfigMaps & Secrets: https://kubernetes.io/docs/concepts/configuration/
- Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Kustomize: https://kubectl.docs.kubernetes.io/guides/introduction/kustomize/
- k3s: https://docs.k3s.io/
- Neon: https://neon.tech/docs/introduction

_Дальше гайд растёт: шаг 3 (SSL к Neon), шаг 4 (поднять кластер), шаг 5 (CI/CD),
шаг 6 (observability/алертинг)._
