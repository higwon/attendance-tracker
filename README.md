# Attendance Tracker

개인·소규모 팀을 위한 출퇴근 기록 웹 앱입니다. 사용자별 기록 분리, 자체 아이디/비밀번호 인증, 오늘 근무 현황, 월간 달력, 주별 통계와 관리자용 계정 관리를 제공합니다.

## 기술 구성

- React + TypeScript + Vite
- Cloudflare Workers
- Cloudflare D1 (SQLite)
- Hono API
- PBKDF2-SHA256 비밀번호 해시 및 보안 쿠키 세션

## 로컬 실행

```bash
npm install
npm run db:migrate:local
npm run dev
```

처음 가입한 계정은 자동으로 관리자가 됩니다.

## Cloudflare 배포

1. Cloudflare에 로그인합니다.

   ```bash
   npx wrangler login
   ```

2. D1 데이터베이스를 생성합니다.

   ```bash
   npx wrangler d1 create attendance-tracker
   ```

3. 출력된 `database_id`를 `wrangler.jsonc`의 `REPLACE_WITH_D1_DATABASE_ID`에 입력합니다.

4. 원격 마이그레이션과 배포를 실행합니다.

   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```

## 기존 기록 이전

기존 `chatgpt.site` 기록은 자동으로 이동되지 않습니다. 새 서비스의 혁진 계정을 **첫 번째 계정으로 먼저 가입**한 뒤, 원본 데이터를 내보내 D1에 사용자 ID와 함께 가져와야 합니다. 실제 기록이나 비밀번호, Cloudflare 토큰은 저장소에 커밋하지 마세요.

## 보안 원칙

- 비밀번호 원문을 저장하지 않습니다.
- 세션 토큰 원문을 DB에 저장하지 않습니다.
- 출퇴근 기록 조회·수정·삭제는 로그인 사용자 ID를 항상 조건으로 사용합니다.
- Cloudflare 자격 증명은 `.dev.vars` 또는 GitHub Secrets로만 관리합니다.
