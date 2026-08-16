import { useAuth } from '../../utils/auth'

export default defineEventHandler(event => useAuth().handler(toWebRequest(event)))
