import { useAuth } from '../../services/auth'

export default defineEventHandler(event => useAuth().handler(toWebRequest(event)))
