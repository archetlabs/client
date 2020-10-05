import { InMemoryCache } from 'apollo-cache-inmemory'
import { ApolloClient } from 'apollo-client'
import { getMainDefinition } from 'apollo-utilities'
import { WebSocketLink } from 'apollo-link-ws'
import { HttpLink } from 'apollo-link-http'
import { onError } from 'apollo-link-error'
import { split } from 'apollo-link'

export const isNode = (typeof process !== 'undefined') && (process.release.name.search(/node|io.js/) !== -1)
export const webSocketImpl = isNode ? require('ws') : WebSocket
export const fetchImpl = isNode ? require('node-fetch') : fetch
export const defaultCache = isNode ? 'none' : 'memory'
export const defaultHeaders = ({
  'Content-Type': 'application/json',
})

export const makeMemoryCache = () => {
  const dataIdFromObject = ({ id }) => id
  return new InMemoryCache({
    addTypename: false,
    dataIdFromObject,
  })
}

export const makeCache = ({ cache: cache = defaultCache }) => {
  switch (cache) {
    case 'memory': return makeMemoryCache()
    // in either case we are required to pass a cache object
    case 'none': return makeMemoryCache()
    default: return cache
  }
}

export const makeCacheOptions = ({ cache = defaultCache }) => {
  switch (cache) {
    case 'memory': return ({
      watchQuery: {
        fetchPolicy: 'cache-and-network',
        errorPolicy: 'all',
      },
      query: {
        fetchPolicy: 'cache-and-network',
        errorPolicy: 'all',
      },
      mutate: {
        errorPolicy: 'all',
      }
    })
    case 'none': return ({
      watchQuery: { fetchPolicy: 'no-cache' },
      query: { fetchPolicy: 'no-cache' },
    })
    default: return ({ })
  }
}
 

export const makeHasuraHeaders = ({ adminSecret, token, headers }) => {
  if (adminSecret) {
    return ({ ...defaultHeaders, 'x-hasura-admin-secret': adminSecret, ...headers })
  } else if (token) {
    return ({ ...defaultHeaders, 'Authorization': `Bearer ${token}`, ...headers })
  } else {
    return ({ ...defaultHeaders, ...headers })
  }
}

export const isSubscription = ({ query }) => {
  const { kind, operation } = getMainDefinition(query)
  return kind === 'OperationDefinition' && operation === 'subscription'
}

export const makeHttpLink = ({ httpUri, headers }) => {
  return new HttpLink({
    uri: httpUri,
    fetch: fetchImpl,
    headers,
    credentials: 'include',
  })
}

export const makeWebSocketLink = ({ webSocketUri, headers }) => {
  return new WebSocketLink({
    uri: webSocketUri,
    webSocketImpl,
    options: {
      reconnect: true,
      connectionParams: {
        headers,
      },
    },
  })
}

export const makeLinkLogoutHandler = (link, config) => {
  return { }
}

export const makeLink = (args) => {
  const { webSocketUri, httpUri } = args
  const connectionType = (
    webSocketUri && httpUri ? 'both' : (
      webSocketUri ? 'websocket' : 'http'
    )
  )
  switch (connectionType) {
    case 'http': {
      const link = makeHttpLink(args)
      return [
        link,
        () => {},
      ]
    }
    case 'websocket': {
      const link = makeWebSocketLink(args)
      return [
        link,
        () => link.subscriptionClient.close(),
      ]
    }
    case 'both': {
      const httpLink = makeHttpLink(args)
      const websocketLink = makeWebSocketLink(args)
      return [
        split(isSubscription, websocketLink, httpLink),
        () => websocketLink.subscriptionClient.close(),
      ]
    }
    default:
      throw "invalid connection type"
  }
}

export const makeHasuraClient = (config) => {
  const cache = makeCache(config)
  const headers = makeHasuraHeaders(config)
  const [link, closeLink] = makeLink({ ...config, headers: makeHasuraHeaders(config) })
  const client = new ApolloClient({
    link,
    cache,
    defaultOptions: {
      ...makeCacheOptions(config),
      ...config.defaultOptions,
    }
  })
  client.originalStop = client.stop
  client.closeLink = closeLink
  client.stop = () => {
    client.originalStop()
    client.closeLink()
  }
  return client
}
