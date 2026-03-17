import { useTransportConnectionState } from './useTransportConnectionState'

export function useIsRemote(): boolean {
  const state = useTransportConnectionState()
  return state?.mode === 'remote'
}
