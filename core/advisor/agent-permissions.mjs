export const ADVISOR_PERMISSION_MODES = Object.freeze([
  'read-only',
  'full-access',
])

// These are the existing, narrowly typed THEIA operations. They remain
// available in read-only mode so an existing advisor workflow keeps working
// without gaining filesystem, shell, or arbitrary-web authority.
export const ADVISOR_CONTROLLED_TOOL_NAMES = Object.freeze([
  'sync_campus_data',
  'network_request',
  'open_campus_source',
  'update_theia_settings',
  'control_course_selection',
])

export const ADVISOR_UNRESTRICTED_TOOL_NAMES = Object.freeze([
  'read_file',
  'write_file',
  'list_directory',
  'create_directory',
  'delete_path',
  'run_command',
  'web_request',
  'open_webpage',
])

export const ADVISOR_FULL_ACCESS_TOOL_NAMES = Object.freeze([
  ...ADVISOR_CONTROLLED_TOOL_NAMES,
  ...ADVISOR_UNRESTRICTED_TOOL_NAMES,
])

const CONTROLLED_CAPABILITIES = Object.freeze([
  'campus-data:read',
  'campus-data:sync',
  'network:public-http',
  'campus-window:open',
  'settings:write',
  'course-selection:control',
])

const FULL_ACCESS_CAPABILITIES = Object.freeze([
  ...CONTROLLED_CAPABILITIES,
  'filesystem:read',
  'filesystem:write',
  'filesystem:delete',
  'process:execute',
  'web:any-request',
  'web:any-open',
])

export function normalizeAdvisorPermissionMode(value) {
  return ADVISOR_PERMISSION_MODES.includes(value) ? value : 'read-only'
}

export function advisorPermissionCapabilities(value) {
  const mode = normalizeAdvisorPermissionMode(value)
  return Object.freeze(mode === 'full-access'
    ? [...FULL_ACCESS_CAPABILITIES]
    : [...CONTROLLED_CAPABILITIES])
}

export function isAdvisorFullAccess(value) {
  return normalizeAdvisorPermissionMode(value) === 'full-access'
}
