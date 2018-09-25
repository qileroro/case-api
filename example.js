const App = require('./index');
const app = new App();
const {get, post, redis, error} = app;

error(async (req, res) => {
  console.log(req.error);
  return 'the error is throw';
});

get('/api/products', async (req, res) => {
  await redis.set('foo', 'bar');
  return await db.query('select * from products');
});

post('/api/products', async (req, res) => {
  return req.data;
});

app.run();
