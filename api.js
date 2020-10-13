const axios = require('axios')

const gasApi = axios.create({
  baseURL: 'https://ethgasstation.info/json/ethgasAPI.json',
  timeout: 10000
})

const ETHGAS = {}

ETHGAS.getGasPrice = _ => gasApi.get()


module.exports = {
  ETHGAS
}
