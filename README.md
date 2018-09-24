case-api
==========

[![NPM](https://nodei.co/npm/case-api.png?compact=true)](https://nodei.co/npm/case-api/)

Create Api

## Install

```
npm install case-api
```

## Usage

```javascript
const App = require('case-api');

const app = new App();

app.get('/test', async (req, res) => {
  return {message: 'ok'};
});

app.run();
```