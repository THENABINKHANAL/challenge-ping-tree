process.env.NODE_ENV = 'test'

const test = require('ava')
const servertest = require('servertest')

const server = require('../lib/server')

const curId = 900

test.serial.cb('healthcheck', (t) => {
  const url = '/health'
  servertest(server(), url, { encoding: 'json' }, (err, res) => {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.is(res.body.status, 'OK', 'status is ok')
    t.end()
  })
})

test.serial.cb(`create target with id ${curId}`, (t) => {
  const req = servertest(server(), '/api/targets', { method: 'POST' },
    (err, res) => {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 201, 'correct statusCode')
      t.end()
    })
  req._write(JSON.stringify({
    id: curId,
    url: 'http://example.com',
    value: 0.50,
    maxAcceptsPerDay: 2,
    accept: {
      geoState: {
        $in: ['ny']
      },
      hour: {
        $in: [13, 14, 15]
      }
    }
  }))
  req.end()
})

test.serial.cb('get all targets', (t) => {
  servertest(server(), '/api/targets', { encoding: 'json' }, (err, res) => {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.end()
  })
})

test.serial.cb(`get target with id ${curId}`, (t) => {
  servertest(server(), `/api/target/${curId}`, { method: 'GET' }, (err, res) => {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.end()
  })
})

test.serial.cb(`update target with id ${curId}`, (t) => {
  const req = servertest(server(), `/api/target/${curId}`, { method: 'POST' },
    (err, res) => {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')
      t.end()
    })
  req._write(JSON.stringify({
    url: 'http://example.com',
    value: 0.50,
    maxAcceptsPerDay: 2,
    accept: {
      geoState: {
        $in: ['ca', 'ny']
      },
      hour: {
        $in: [13, 14, 15]
      }
    }
  }))
  req.end()
})

test.serial.cb(`route ${curId} first request`, (t) => {
  const req = servertest(server(), '/route', { method: 'POST' },
    (err, res) => {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')
      t.end()
    })
  let timeStamp = (new Date()).toISOString()
  timeStamp = timeStamp.slice(0, 11) + '14' + timeStamp.slice(13)
  req._write(JSON.stringify({
    geoState: 'ca',
    publisher: 'abc',
    timestamp: timeStamp
  }))
  req.end()
})

test.serial.cb(`route ${curId} second request`, (t) => {
  const req = servertest(server(), '/route', { method: 'POST' },
    (err, res) => {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')
      t.end()
    })
  let timeStamp = (new Date()).toISOString()
  timeStamp = timeStamp.slice(0, 11) + '14' + timeStamp.slice(13)
  req._write(JSON.stringify({
    geoState: 'ca',
    publisher: 'abc',
    timestamp: timeStamp
  }))
  req.end()
})

test.serial.cb(`route ${curId} third request`, (t) => {
  const req = servertest(server(), '/route', { method: 'POST' },
    (err, res) => {
      t.truthy(err == null, 'error')
      t.is(res.statusCode, 400, 'correct statusCode')
      t.end()
    })
  let timeStamp = (new Date()).toISOString()
  timeStamp = timeStamp.slice(0, 11) + '14' + timeStamp.slice(13)
  req._write(JSON.stringify({
    geoState: 'ca',
    publisher: 'abc',
    timestamp: timeStamp
  }))
  req.end()
})
