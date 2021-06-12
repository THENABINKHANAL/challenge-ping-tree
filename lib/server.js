const URL = require('url')
const http = require('http')
const cuid = require('cuid')
const Corsify = require('corsify')
const sendJson = require('send-data/json')
const ReqLogger = require('req-logger')
const healthPoint = require('healthpoint')
const HttpHashRouter = require('http-hash-router')
const { StringDecoder } = require('string_decoder')
const UrlPattern = require('url-pattern')

const { promisify } = require('util')
const redis = require('./redis')
const { version } = require('../package.json')

promisify(redis.get).bind(redis)
promisify(redis.set).bind(redis)

const router = HttpHashRouter()
const logger = ReqLogger({ version })
const health = healthPoint({ version }, redis.healthCheck)
const cors = Corsify({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, accept, content-type'
})

router.set('/favicon.ico', empty)

module.exports = function createServer () {
  return http.createServer(cors(handler))
}

function handler (req, res) {
  const pattern = new UrlPattern('/api/target(/:id)')
  if (req.url === '/health') return health(req, res)
  if (req.url === '/api/targets') return handleTargets(req, res)
  if (pattern.match(req.url)) return handelTargetById(req, res)
  if (req.url === '/route') return handleRoute(req, res)

  req.id = cuid()
  logger(req, res, { requestId: req.id }, (info) => {
    info.authEmail = (req.auth || {}).email
  })
  router(req, res, { query: getQuery(req.url) }, onError.bind(null, req, res))
}

async function handleTargets (req, res) {
  if (req.method.toLowerCase() === 'get') {
    const allData = []
    const data = await getAllValues('targets')
    for (const k in data) {
      allData.push(JSON.parse(data[k]))
    }
    res.writeHead(200, 'ok')
    res.write(JSON.stringify(allData))
    res.end('')
  }

  if (req.method.toLowerCase() === 'post') {
    handelPost(req, res)
  }
}

async function handelPost (req, res) {
  const decoder = new StringDecoder('utf-8')
  let buffer = ''

  req.on('data', (data) => {
    buffer += decoder.write(data)
  })

  req.on('end', async () => {
    buffer += decoder.end()
    const data = await JSON.parse(buffer)
    if (data.id != null) {
      const currentData = await getValue('targets', data.id)
      if (currentData[0] != null) {
        data.id = null
        res.writeHead(409, { 'Content-Type': 'application/json' })
        const errorResponse = { error: 'id already used' }
        res.write(JSON.stringify(errorResponse))
      }
    } else {
      data.id = Math.round(Math.random() * 1000000)
      while ((await getValue('targets', data.id)[0]) != null) {
        data.id = Math.round(Math.random() * 1000000)
      }
    }
    if (data.id != null) {
      const stringData = JSON.stringify(data)
      await addToRedis('targets', data.id, stringData)
      const newResult = await getValue('targets', data.id)
      res.writeHead(201, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify(newResult))
    }
    res.end()
  })
}

async function handelPostById (req, res, id) {
  const decoder = new StringDecoder('utf-8')
  let buffer = ''

  req.on('data', (data) => {
    buffer += decoder.write(data)
  })

  req.on('end', async () => {
    buffer += decoder.end()
    const data = await JSON.parse(buffer)
    data.id = id
    const stringData = JSON.stringify(data)
    await addToRedis('targets', data.id, stringData)
    const newResult = await getValue('targets', data.id)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write(JSON.stringify(newResult))
    res.end()
  })
}

async function handelTargetById (req, res) {
  const pattern = new UrlPattern('/api/target(/:id)')
  const id = pattern.match(req.url).id.toString()

  if (req.method.toLowerCase() === 'get') {
    const result = await getValue('targets', id)
    if (result) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify(result))
      res.end()
    } else {
      res.writeHead(400, 'Not Found')
      res.write('Error getting object')
      res.end()
    }
  }
  if (req.method.toLowerCase() === 'post') {
    const obj = await getValue('targets', id)
    if (obj) {
      handelPostById(req, res, id)
    } else {
      res.writeHead(400, 'Not Found')
      res.write('Error getting object')
      res.end()
    }
  }
  if (req.method.toLowerCase() === 'delete') {
    const obj = await getValue('targets', id)
    if (obj[0]) {
      await removeKey('targets', id)
      res.writeHead(200)
      res.end()
    } else {
      res.writeHead(400, 'Not Found')
      res.write('Error getting object')
      res.end()
    }
  }
}

async function handleRoute (req, res) {
  if (req.method.toLowerCase() === 'post') {
    const decoder = new StringDecoder('utf-8')
    let buffer = ''

    req.on('data', (data) => {
      buffer += decoder.write(data)
    })

    req.on('end', async () => {
      buffer += decoder.end()

      const UserData = await JSON.parse(buffer)
      const loc = UserData.geoState
      const date = new Date(UserData.timestamp)
      const tstamp = date.getUTCHours()
      let allData = []
      const data = await getAllValues('targets')
      for (const k in data) {
        const dat = await JSON.parse(data[k])
        allData.push(dat)
      }
      allData = await filterExpiration(allData)
      allData = await filterLocation(allData, loc)
      allData = await filterTime(allData, tstamp)
      if (!allData) {
        errorResponse(res)
        return
      }

      const allCounts = []
      const data2 = await getAllValues('counts')
      for (const k in data2) {
        const dat = await JSON.parse(data2[k])
        allCounts.push(dat)
      }
      // rejectKeys = filterCount(allData);
      const acceptData = filterDataCount(allData, allCounts)
      const finalData = maxValueData(acceptData)
      if (finalData) {
        const value = await getValue('counts', finalData.id)
        if (value[0]) {
          await addToRedis('counts', finalData.id, parseInt(value[0]) + 1)
        } else {
          await addToRedis('counts', finalData.id, 1)
          await addToRedisExpiration(finalData.id)
        }
        res.writeHead(200, 'accepted', { 'Content-Type': 'application/json' })
        res.write(JSON.stringify(finalData.url))
        res.end()
      } else {
        res.writeHead(400, 'rejected', { 'Content-Type': 'application/json' })
        res.write(JSON.stringify({ decision: 'reject' }))
        res.end()
      }
    })
  }
}

async function filterExpiration (data) {
  const allData = []
  for (let i = 0; i < data.length; i++) {
    const dat = data[i]
    const expiration = await getValue('expiration', dat.id)
    if (expiration[0]) {
      const exp = parseInt(expiration[0])
      if (exp > Date.now()) {
        allData.push(dat)
      } else {
        await removeKey('expiration', dat.id)
        await addToRedis('counts', dat.id, 0)
      }
    } else {
      allData.push(dat)
    }
  }
  return allData
}

async function removeKey (category, key) {
  return new Promise((resolve, reject) => {
    redis.hdel(category, key, (err, reply) => {
      if (err) {
        reject(err)
      } else {
        resolve(reply)
      }
    })
  })
}

function filterLocation (data, loc) {
  const acceptData = []

  for (let i = 0; i < data.length; i++) {
    if (presentIn(loc, data[i].accept.geoState.$in)) {
      acceptData.push(data[i])
    }
  }
  return acceptData
}

function filterTime (data, tim) {
  const acceptData = []
  for (let i = 0; i < data.length; i++) {
    if (presentIn(tim, data[i].accept.hour.$in)) {
      acceptData.push(data[i])
    }
  }
  return acceptData
}

function filterDataCount (data, counts) {
  const adata = []
  for (const k in data) {
    if (!counts[k]) {
      adata.push(data[k])
    } else if (parseInt(data[k].maxAcceptsPerDay) > counts[k]) {
      adata.push(data[k])
    }
  }
  return adata
}

function presentIn (val, arr) {
  for (let i = 0; i < arr.length; i++) {
    if (val === arr[i]) {
      return true
    }
  }
  return false
}

function addToRedis (category, key, value) {
  return new Promise((resolve, reject) => {
    redis.hmset(category, { [key]: value }, (err, reply) => {
      if (err) {
        reject(err)
      } else {
        resolve(reply)
      }
    })
  })
}

function addToRedisExpiration (key) {
  return new Promise((resolve, reject) => {
    const expiration = Date.now() + (24 * 60 * 60 * 1000)
    redis.hmset('expiration', { [key]: expiration }, (err, reply) => {
      if (err) {
        reject(err)
      } else {
        resolve(reply)
      }
    })
  })
}

function getValue (category, key) {
  return new Promise((resolve, reject) => {
    redis.hmget(category, key, (err, object) => {
      if (err) {
        reject(err)
      } else {
        resolve(object)
      }
    })
  })
}

function getAllValues (category) {
  return new Promise((resolve, reject) => {
    redis.hgetall(category, (err, object) => {
      if (err) {
        reject(err)
      } else {
        resolve(object)
      }
    })
  })
}

function maxValueData (allData) {
  if (!allData) {
    return null
  }
  let data = allData[0]
  let max = -9999999
  for (let i = 1; i < allData.length; i++) {
    if (allData[i].value > max) {
      data = allData[i]
      max = allData[i].value
    }
  }
  return data
}

function onError (req, res, err) {
  if (!err) return

  res.statusCode = err.statusCode || 500
  logError(req, res, err)

  sendJson(req, res, {
    error: err.message || http.STATUS_CODES[res.statusCode]
  })
}

function logError (req, res, err) {
  if (process.env.NODE_ENV === 'test') return

  const logType = res.statusCode >= 500 ? 'error' : 'warn'

  console[logType](
    {
      err,
      requestId: req.id,
      statusCode: res.statusCode
    },
    err.message
  )
}

function errorResponse (res) {
  res.writeHead(400, 'rejected', { 'Content-Type': 'application/json' })
  res.write(JSON.stringify({ decision: 'reject' }))
  res.end()
}

function empty (req, res) {
  res.writeHead(204)
  res.end()
}

function getQuery (url) {
  return URL.parse(url, true).query; // eslint-disable-line
}
