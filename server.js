const charset = require('charset')
const { default: fetch } = require('node-fetch-h2')
const http = require('http')
const https = require('https')
const { load } =require('cheerio')
const { parse } = require('content-type')
const { decode, encode } = require('iconv-lite')

const port = 3000
const yearmonthday = 2008
const proxyName = 'timeprox'
require('events').EventEmitter.defaultMaxListeners = 15

const httpAgent = new http.Agent({
  //keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 30000,
})
const httpsAgent = new https.Agent({
  //keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 30000,
})
//const agent = (_parsedURL) => _parsedURL.protocol == 'http:' ? httpAgent : httpsAgent

/**

from fetch-charset-detection
Get the character set from a Content-Type header.

@param contentType The Content-Type HTTP header.
*/
const parseContentType = (contentType) => {
	try {
		return parse(contentType).parameters.charset
	} catch {
		return contentType
	}
}

process.on('uncaughtException', e => { console.error(e) })
process.on('unhandledRejection', e => { throw e })

const pad = v => `${v.toString().length === 1 ? '0' : ''}${v}`

const formatOffset = date => {
  const offset = date.getTimezoneOffset()
  const p = offset < 0 ? '+' : '-'
  const h = pad(Math.floor(Math.abs(offset) / 60))
  const m = pad(Math.abs(offset) % 60)
  return `${p}${h}:${m}`
}

const formatDate = (date = new Date()) => {
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const n = pad(date.getMinutes())
  const s = pad(date.getSeconds())
  const z = `${formatOffset(date)}`
  return `${y}-${m}-${d}T${h}:${n}:${s}${z}`
}

const log = msg => {
  console.log(`[${formatDate()}] ${msg}`)
}


const arcUrl = url => {
  const { pathname } = new URL(url)
  //FIXME: get the wrongurl
  const sub_regex = /(im_\/|fw_\/|js_\/|cs_\/|if_\/|oe_\/)(https?:\/\/.*)/
  let match
  let sub_prefix
  let sub_url = pathname
  while( (match = sub_regex.exec(sub_url)) != null ) {
	  sub_prefix = match[1]
	  sub_url = match[2]
	  match = null
  }
  if (sub_prefix != null) {
	  const pathname_url = `${sub_prefix}${sub_url}`
	  return `https://web.archive.org/web/${yearmonthday}${pathname_url}`
  }
  return /^\/web\/\d+(im_|fw_|js_|cs_|if_|oe_)?\//.test(pathname)
    ? `https://web.archive.org${pathname}`
    : `https://web.archive.org/web/${yearmonthday}/${url}`
}
//.replace(/\/web\/\d+(im_|fw_|js_|cs_)?\/?/g, '')

const filterBody = body => body
  .replace(/https?:\/\/web\.archive\.org/g, '')
  .replace(/\/web\/\d+((im_|fw_|js_|cs_)\/?)?\/?/g, "$1")
  .replace(/^[\s\t\r\n]+</i, '<')
  .replace(/(<head[^>]*>)(.|[\r\n])*<!-- End Wayback Rewrite JS Include -->/i, '$1')
  .replace(/(<html[^>]*>)(.|[\r\n])*<!-- End Wayback Rewrite JS Include -->/i, '$1')

const isStartOf = (substr, str) => str.toString().slice(0, substr.length) === substr

const isFetchResText = fetchRes => {
  const contentType = fetchRes.headers.raw()['content-type'] ? fetchRes.headers.raw()['content-type'] : ''
  return !!['text/html', 'text/plain']
    .find(type => isStartOf(type, contentType))
}

const isFetchResTs404 = fetchRes => fetchRes.headers.get('x-ts') === '404'

const isFetchResYear = (setYear, fetchRes) => isStartOf(
  `/web/${setYear}`, (new URL(fetchRes.url)).pathname,
)

const setContentType = (fetchRes, body_buffer, res) => {
  const { headers } = fetchRes
  const contentType = headers.get('content-type')
  let guessedContentType
  let guessedCharset
  let scanCharset
  let finalCharset

  //if null
  if (!contentType) {
    guessedContentType = headers.get('x-archive-guessed-content-type')
    guessedCharset = headers.get('x-archive-guessed-charset')
    const mimeCharset = guessedCharset ? `; charset=${guessedCharset}` : ''
    log(`guessedCharset => ${guessedCharset}`)

    if (guessedContentType && guessedCharset) {
      res.setHeader('content-type', `${guessedContentType}${mimeCharset}`)
    }
  }
  //need to scan charset or use guessedCharset
  //
  if (!charset(contentType)) {
	if ( guessedCharset ) {
	  if ( !guessedContentType ) {
		//when contentType is null we have guessdCharset but no guessContent, havent apply, so this should be WARNING
		//when contentType is not null, will not achieve here as guessedCharset is null
	  }
	  //when contentType is null then we have a guessdCharset, here, so apply this first
	  finalCharset = guessedCharset
	  log(`get guessedCharset => ${guessedCharset}`)
	  //when contentType is not null, will not achieve here as guessedCharset is null
	}else{
	  //When contentType is null and guessdCharset is null it mean havent apply yet, we need to check
	  //when contentType is not null, but we have no charset, we also need a check to see if we need
	  //from fetch-charset-detection
	  // No charset in content type, peek at response body for at most 4096 bytes, then filter it
	  const data = filterBody(body_buffer.slice(0, 2048).toString())
	  //not support scan contenType yet, use known first, guessedContentType second
	  if (data) {
        const $ = load(data)
        scanCharset = parseContentType(
          $('meta[charset]').attr('charset') // HTML5
          || $('meta[http-equiv=Content-Type][content]').attr('content') // HTML4
          || load(data.replace(/<\?(.*)\?>/im, '<$1>'), {xmlMode: true}).root().find('xml').attr('encoding'), // XML
        )
        // Prevent decode issues when sites use incorrect encoding
        // ref: https://hsivonen.fi/encoding-menu/
        if (scanCharset && ['gb2312', 'gbk'].includes(scanCharset.toLowerCase())) {
          scanCharset = 'gb18030'
        }
	  }
	  finalCharset = scanCharset
	  log(`get scanCharset => ${scanCharset}`)
	}
	const mimeCharset = finalCharset ? `; charset=${finalCharset}` : ''
	log(`mime contentType => ${contentType}${mimeCharset}`)
	res.setHeader('content-type', `${contentType}${mimeCharset}`)
  } else {
	//we have charset in content, good
	res.setHeader('content-type', `${contentType}`)
	log(`contentType => ${contentType}`)
  }
  //res.setHeader('content-type', res.getHeader('content-type')[0].replace('_', '-'))
  log(`res.getHeader process => ${res.getHeader('content-type')}`)
}

const setHeaders = (fetchRes, body_buffer, req, res) => {
  const headers = fetchRes.headers.raw()
//NEED_FIX: BELOW WILL AFFECT SOME WEBSITES
/*
  Object.keys(headers).forEach(name => {
    if (['content-encoding', 'link', 'transfer-encoding'].includes(name)) return
    if ([/^x-archive-(?!orig)/].find(r => r.test(name))) return
    res.setHeader(name.replace(/^x-archive-orig-/, ''), headers[name])
  })
*/
  res.setHeader(`x-${proxyName}-archive-url`, fetchRes.url)
  res.setHeader(`x-${proxyName}-request-time`, formatDate())
  res.setHeader(`x-${proxyName}-request-url`, req.url)
  res.setHeader(`Content-Length`, '')
  res.setHeader(`Transfer-Encoding`, 'chunked')
  //res.setHeader(`Transfer-Encoding`, '')
  setContentType(fetchRes, body_buffer, res)
}

const sendBody = (fetchRes, body_buffer, res) => {
  if (!isFetchResText(fetchRes)) {
    res.end(body_buffer)
    return
  }

  const contentType = res.getHeader('content-type')
  const bodyCharset = charset(contentType) || 'utf8'
  log(`bodyCharset => ${bodyCharset}, contentType => ${contentType}`)
  const src = decode(body_buffer, bodyCharset)
  const filtered = filterBody(src)
  //log(`filtered => ${filtered}`)
  const resBody = encode(filtered, bodyCharset)
  //res.end(resBody, bodyCharset)
  res.end(resBody)

}

const notFound = res => res.writeHead(404).end(`${proxyName}: Not Found`)
const serverError = (res, e) => res.writeHead(500).end(`${proxyName}: Server Error\n\n${e}`)
//this function is for test, it can be replace with original fetch()
const retryFetch = async (url, options, retries = 5, delay = 1000) => {
  let lastError
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options)
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`)
      return response;  // sucess
    } catch (error) {
      lastError = error;
      console.log(`attempt ${attempt + 1} fail，error: ${error.message}`);
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError; // error return
};


const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
const server = http.createServer(async (req, res) => {
  const targetUrl = new URL(arcUrl(req.url));
  const aagent = targetUrl.protocol === 'https:' ? httpsAgent : httpAgent;
  await fetch(targetUrl, {
  //headers: {
	//'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
	//'Connection': 'Keep-Alive'
  //},
  agent: aagent,
  timeout: 30000,
})
  .then((fetchRes) => {
	fetchRes.arrayBuffer().then((body) => {
      const body_buffer = Buffer.from(body)
      log(`${req.url} => ${fetchRes.url}`)
	  log(`fetchRes.status => ${fetchRes.status}`)
      if (isFetchResTs404(fetchRes)) return notFound(res)
      // if (!isFetchResYear(year, fetchRes)) return notFound(res)
      setHeaders(fetchRes, body_buffer, req, res)
      return sendBody(fetchRes, body_buffer, res)
	})
  }).catch(e => serverError(res, e))
})

log(`HTTP Proxy: http://localhost:${port}`)
server.listen(port)
