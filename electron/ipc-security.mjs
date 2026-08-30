export {
  MAX_IPC_ARGUMENT_BYTES,
  RETRIABLE_SYNC_DOMAIN_IDS,
  THEIA_IPC_SCHEMAS,
  validateIpcArguments,
} from './ipc-security-validation.mjs'
export {
  assertTrustedMainFrame,
  createTrustedIpc,
  isExactTrustedEntryUrl,
} from './ipc-security-trust.mjs'
