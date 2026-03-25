# code_protector_aws

Rewrite of `code_protector` for AWS-only runtime:

- Frontend: static assets on S3 + CloudFront
- Backend: single Lambda (modular monolith) behind Lambda Function URL
- Data: DynamoDB multi-table
- Object storage: S3 (`r2:<key>` content references)

## Project Structure

- `frontend/` static pages (`/`, `/login`, `/register`, `/dashboard`, `/workspace/*`)
- `src/` Lambda backend (router + controllers + Dynamo/S3 services)
- `infra/template.yaml` SAM/CloudFormation stack

## Implemented API Surface

Includes parity-focused routes for:

- Auth: `/api/login`, `/api/register`, `/api/user/*`
- Workspaces: `/api/workspaces*`, logs, PIN
- Projects: `/api/workspaces/:id/projects`, `/api/projects/:id*`, script aliases
- Files: `/api/projects/:id/files*`, `/api/projects/:id/bundle`
- Licenses: `/api/workspaces/:id/licenses*`, `/api/licenses/:id*`
- Access rules: `/api/workspaces/:id/access-lists*`, `/api/access-lists/:id`
- Team/invitations: `/api/workspaces/:id/team*`, `/api/invitations/:token*`
- Loader: `/files/:id.py`, `/files/:id.js`, `/api/v5/execute`, `/api/v5/handshake`
- WebSocket: `/api/ws/config` (HTTP discovery) + API Gateway WebSocket channels

## Frontend Hosting Behavior

CloudFront rewrite behavior in `infra/template.yaml`:

- `/` -> `/index.html`
- `/login` -> `/login/index.html`
- `/register` -> `/register/index.html`
- `/dashboard` -> `/dashboard/index.html`
- `/workspace/*` -> `/workspace/index.html`
- `/docs` -> `/docs/index.html`
- `/docs/*` -> `/docs/*/index.html` (for deep links without extension)

## Environment Variables (Lambda)

Core variables used by backend:

- `ALLOWED_ORIGINS`
- `CONTENT_BUCKET`
- `DDB_TABLE_USERS`
- `DDB_TABLE_WORKSPACES`
- `DDB_TABLE_WORKSPACE_MEMBERS`
- `DDB_TABLE_WORKSPACE_INVITATIONS`
- `DDB_TABLE_PROJECTS`
- `DDB_TABLE_PROJECT_FILES`
- `DDB_TABLE_LICENSES`
- `DDB_TABLE_ACCESS_LISTS`
- `DDB_TABLE_LOGS`
- `DDB_TABLE_PIN_VERIFICATIONS`
- `DDB_TABLE_RATE_LIMITS`
- `DDB_TABLE_APP_CONFIG`

## Local Development

```bash
npm install
npm run dev
```

Local server starts at `http://localhost:3001` and routes through the same Lambda handler (`src/index.js`).

## Documentation Site (`/docs`)

Docs are static assets under `frontend/docs/` and are published with the normal frontend deploy.

- Overview: `/docs`
- UI Guide (with screenshots): `/docs/web-ui`
- API (ReDoc): `/docs/api`
- WebSocket appendix: `/docs/api/websocket`
- Raw OpenAPI spec: `/docs/openapi.yaml`

### Docs Commands

```bash
npm run docs:mock-api          # deterministic local API fixtures for docs capture
npm run docs:host              # serves frontend with /api and /files proxy
npm run docs:capture           # generate screenshots + docs manifest
npm run docs:validate-openapi  # validate OpenAPI syntax/refs
npm run docs:check-parity      # compare src/router.js vs OpenAPI paths/methods
npm run docs:check             # run both checks
```

## AWS Deploy

1. Build and deploy stack:

```bash
sam build --template-file infra/template.yaml
sam deploy --template-file infra/template.yaml --guided
```

2. Upload frontend:

```bash
aws s3 sync frontend/ s3://<FrontendBucketName> --delete
```

3. Invalidate CloudFront cache after frontend updates.

## GitHub Actions Deploy (Recommended)

Workflow file:

- `.github/workflows/deploy-aws.yml`
- `.github/workflows/docs-check.yml` (OpenAPI + parity checks, optional manual screenshot capture artifact)

What it does on `push` to `main` (or manual `workflow_dispatch`):

1. Build Lambda artifact zip from `src/` + `node_modules`
2. Upload artifact to S3
3. Deploy/update CloudFormation stack from `infra/template.yaml`
4. Sync `frontend/` to S3 hosting bucket
5. Create CloudFront invalidation

### 1) Configure GitHub Secrets / Variables

Required secret:

- `AWS_ROLE_TO_ASSUME`: IAM Role ARN used by GitHub OIDC

Required repository variable:

- `LAMBDA_ARTIFACT_BUCKET`: S3 bucket to store Lambda zip artifacts
  - Workflow auto-creates this bucket if it does not exist (role must allow `s3:CreateBucket`).

Recommended repository variables:

- `AWS_REGION` (default `ap-southeast-2`)
- `STACK_NAME` (for example: `code-protector-aws-prod4-stack`)
- `PROJECT_NAME` (default `code-protector-aws`)
- `STAGE` (default `prod`)
- `ALLOWED_ORIGINS` (default `*`, supports comma-separated list)
- `FRONTEND_BUCKET_NAME` (optional; leave empty to let stack generate)
- `LAMBDA_MEMORY_SIZE` (default `1024`)
- `LAMBDA_TIMEOUT` (default `30`)
- `LAMBDA_LOG_RETENTION_DAYS` (default `30`)
- `MANAGE_API_LOG_GROUP` (default `false`; set `true` only when Lambda log group does not already exist)
- `ENABLE_CLOUDWATCH_ALARMS` (default `true`)

### 2) Configure IAM OIDC Trust

Trust policy example for role `AWS_ROLE_TO_ASSUME`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<ORG_OR_USER>/<REPO>:*"
        }
      }
    }
  ]
}
```

The role needs permissions for:

- CloudFormation deploy/update
- S3 upload/sync (artifact + frontend buckets), including `s3:CreateBucket` for artifact bootstrap
- CloudFront invalidation
- IAM/Lambda/DynamoDB/Logs permissions needed by stack resources

### 3) Push to GitHub

Push to `main` to trigger deploy automatically, or run workflow manually from Actions tab.

If this folder is not a Git repo yet, bootstrap quickly:

```bash
git init
git add .
git commit -m "chore: bootstrap code_protector_aws aws deploy pipeline"
git branch -M main
git remote add origin https://github.com/<ORG_OR_USER>/<REPO>.git
git push -u origin main
```

## Notes

- DynamoDB schema is multi-table (users/workspaces/projects/files/licenses/access/logs/team/pin/rate-limit/app-config).
- GSIs are defined for loader key, owner workspace listing, project secret key, license key, invitation token, and workspace-scoped queries.
- No SQLite dependency in this rewrite. Realtime WebSocket is supported via API Gateway + Lambda integration.
- CloudWatch log retention is managed by template parameter `LambdaLogRetentionDays` via `ApiFunctionLogGroup`.
- To avoid update failures on existing stacks, `ApiFunctionLogGroup` creation is controlled by `ManageApiLogGroup` (default `false`).
- CloudWatch monitoring can be toggled by template parameter `EnableCloudWatchAlarms` (dashboard + alarms for errors/throttles/p95 duration).
