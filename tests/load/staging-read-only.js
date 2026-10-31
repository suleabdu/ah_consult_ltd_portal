/**
 * AHCT staging-only read-path baseline, run after written approval from the hosting provider.
 * Example: STAGING_URL=https://your-branch-preview.vercel.app k6 run tests/load/staging-read-only.js
 * This is NOT a 100,000 rps test and must never be targeted at a production hostname.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
const target = (__ENV.STAGING_URL || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(target)) throw new Error('Supply a non-production STAGING_URL.');
const hostname = new URL(target).hostname;
if (!/(^localhost$|^127\.0\.0\.1$|staging|preview|-[a-z0-9]+\.vercel\.app$)/i.test(hostname)) {
  throw new Error('Refusing load test: hostname must clearly indicate staging or localhost.');
}
export const options = {
  scenarios: {
    read_only: {
      executor: 'ramping-arrival-rate', timeUnit: '1s', startRate: 5,
      preAllocatedVUs: 20, maxVUs: 100,
      stages: [ {target: 10, duration: '30s'}, {target: 30, duration: '30s'}, {target: 50, duration: '30s'}, {target: 0, duration: '10s'} ],
    },
  },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<700'], dropped_iterations: ['count<1'] },
};
export default function () {
  const page = ['/', '/apply', '/student-login'][__VU % 3];
  const res = http.get(target + page, {headers:{'User-Agent':'AHCT-staging-k6-read-test/1.0'},tags:{route:page}});
  check(res, {'HTTP 200':r=>r.status===200, 'HTML delivered':r=>String(r.headers['Content-Type']||'').includes('text/html')});
  sleep(0.5);
}
