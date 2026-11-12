const BUSINESS_HOST = 'business.offlinesms.com';
const BUSINESS_PAGES = ['/', '/login', '/register', '/groups', '/send', '/points', '/activity', '/activity/:batchId', '/integrations'];

function businessDestination(path) {
  return path === '/' ? '/business' : `/business${path}`;
}

module.exports = { BUSINESS_HOST, BUSINESS_PAGES, businessDestination };
