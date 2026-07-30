# AI 성공의 퍼즐조각

홍창준 저자의 《비즈니스 성공의 퍼즐조각》을 기반으로 한 상업용 자기점검·90일 실행·전자책·AI 코칭 PWA입니다.

- 운영 서비스: https://ai-success-puzzle.hhongcjun.workers.dev
- 관리자 초기 비밀번호: 배포 환경의 `ADMIN_BOOTSTRAP_PASSWORD` Secret으로만 설정
- 현재 AI 상태: OpenAI 미설정 시 Cloudflare Workers AI 기본 코치 사용

## 로컬 실행

```powershell
npm install
npm run dev
```

AI와 관리자 비밀번호는 소스가 아닌 Cloudflare Secret 또는 암호화된 관리자 설정으로 관리합니다.

## 검증

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run cf:check
```

## 배포

1. D1/R2 리소스를 생성하고 `wrangler.jsonc`의 D1 ID를 갱신합니다.
2. D1 migration을 적용합니다.
3. `ADMIN_BOOTSTRAP_PASSWORD`, `SETTINGS_ENCRYPTION_KEY` Secret을 등록합니다.
4. 원본 PDF를 비공개 R2 객체로 업로드합니다.
5. `npm run deploy`를 실행합니다.

## 권리와 보안

책 PDF는 GitHub 저장소에 포함하지 않습니다. 비공개 R2에 저장하고 Worker의 권리 승인 설정을 통과한 경우에만 스트리밍합니다. OpenAI 키와 관리자 비밀번호도 소스에 포함하지 않습니다.
