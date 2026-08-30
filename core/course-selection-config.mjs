export const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
export const INDEX_URL = new URL('xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default', BASE).toString()
export const DISPLAY_URL = new URL('xsxk/zzxkyzb_cxZzxkYzbDisplay.html?gnmkdm=N253512', BASE).toString()
export const COURSE_URL = new URL('xsxk/zzxkyzb_cxZzxkYzbPartDisplay.html?gnmkdm=N253512', BASE).toString()
export const CLASS_URL = new URL('xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html?gnmkdm=N253512', BASE).toString()
export const CLASS_COMPONENT_URL = new URL('xsxk/zzxkyzb_xkZyZzxkYzbZjxb.html?gnmkdm=N253512', BASE).toString()
// The `jk_` variant is the endpoint used by Zhengfang's saveCourse() flow.
export const SELECT_URL = new URL('xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html?gnmkdm=N253512', BASE).toString()
export const SCHOOL_SCHEDULE_INDEX_URL = new URL('design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N219933', BASE).toString()

// A target lookup may need to fall back to the unfiltered catalog when a
// Zhengfang deployment ignores its search fields.
export const COURSE_SELECTION_MAX_SCAN_PAGES = 50
export const JOB_LOG_LIMIT = 80

export const CATALOG_CONTEXT_FIELDS = [
  'rwlx', 'xklc', 'xkly', 'bklx_id', 'sfkkjyxdxnxq', 'kzkcgs',
  'xqh_id', 'jg_id', 'njdm_id_1', 'zyh_id_1', 'gnjkxdnj',
  'zyh_id', 'zyfx_id', 'njdm_id', 'bh_id', 'bjgkczxbbjwcx',
  'xbm', 'xslbdm', 'mzm', 'xz', 'ccdm', 'xsbj', 'sfkknj',
  'sfkkzy', 'kzybkxy', 'sfznkx', 'zdkxms', 'sfkxq', 'bhbcyxkjxb',
  'sfkcfx', 'kkbk', 'kkbkdj', 'bklbkcj', 'sfkgbcx', 'sfrxtgkcxd',
  'xkkz_xh', 'tykczgxdcs', 'xkxnm', 'xkxqm', 'kklxdm', 'bbhzxjxb',
  'zxgbxkkg', 'xkkz_id', 'rlkz', 'xkzgbj', 'kspage', 'jspage',
]

export const CLASS_CONTEXT_FIELDS = [
  'rwlx', 'xklc', 'xkly', 'bklx_id', 'sfkkjyxdxnxq', 'kzkcgs',
  'xqh_id', 'jg_id', 'zyh_id', 'zyfx_id', 'txbsfrl',
  'njdm_id', 'bh_id', 'xbm', 'xslbdm', 'mzm', 'xz', 'ccdm', 'xsbj',
  'sfkknj', 'gnjkxdnj', 'sfkkzy', 'kzybkxy', 'sfznkx', 'zdkxms',
  'sfkxq', 'bhbcyxkjxb', 'sfkcfx', 'bbhzxjxb', 'kkbk', 'kkbkdj',
  'bklbkcj', 'xkxnm', 'xkxqm', 'xkxskcgskg', 'rlkz', 'cdrlkz',
  'cxcykclxxskg', 'rlzlkz', 'kklxdm', 'kch_id', 'jxbzcxskg',
  'zxgbxkkg', 'xkkz_id', 'cxbj', 'fxbj',
]

export const SELECTION_STAGE_FIELDS = ['iskxk', 'isinxksj', 'isInylsj', 'xksjxskz']
