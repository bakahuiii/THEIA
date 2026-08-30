export const JWGLXT_HOST = 'jwglxt.buct.edu.cn'

// Read-only JWGLXT pages that are useful to students but are not part of the
// nine fast-path datasets. Mutation-looking menu entries are deliberately not
// listed here: a GET of an application page is not a safe data contract.
export const JWGLXT_EXTRA_DOMAINS = Object.freeze({
  'academic-plan': Object.freeze({
    label: '培养方案与教学执行计划',
    routes: Object.freeze([
      Object.freeze({ code: 'N153540', path: 'jxzxjhgl/jxzxjhck_cxJxzxjhckIndex.html?gnmkdm=N153540&layout=default' }),
    ]),
  }),
  'academic-warning': Object.freeze({
    label: '学业预警',
    routes: Object.freeze([
      Object.freeze({ code: 'N105505', path: 'xjyj/xjyj_cxXjyjIndex.html?gnmkdm=N105505&layout=default' }),
      Object.freeze({ code: 'N305516', path: 'xyyjjk/xyyjclcx_cxXyyjclcxxsIndex.html?gnmkdm=N305516&layout=default' }),
    ]),
  }),
  'graduation-audit': Object.freeze({
    label: '毕业审核',
    routes: Object.freeze([
      Object.freeze({ code: 'N105508', path: 'bygl/bysh_cxByshjgHcIndex.html?gnmkdm=N105508&layout=default' }),
    ]),
  }),
  'grade-details': Object.freeze({
    label: '成绩明细',
    routes: Object.freeze([
      Object.freeze({ code: 'N305007', path: 'cjcx/cjcx_cxDgXsxmcj.html?gnmkdm=N305007&layout=default' }),
    ]),
  }),
  'exam-extra': Object.freeze({
    label: '考试附加信息',
    routes: Object.freeze([
      Object.freeze({ code: 'N358163', path: 'design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N358163&layout=default' }),
      Object.freeze({ code: 'N358187', path: 'design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N358187&layout=default' }),
      Object.freeze({ code: 'N352510', path: 'bkgl/bkmdwh_cxBkmdIndex.html?gnmkdm=N352510&layout=default' }),
    ]),
  }),
  'free-classroom': Object.freeze({
    label: '空闲教室',
    routes: Object.freeze([
      Object.freeze({ code: 'N2155', path: 'cdjy/cdjy_cxKxcdlb.html?gnmkdm=N2155&layout=default' }),
    ]),
  }),
  // Keep this distinct from the local `school-schedule` catalogue domain.
  // The latter is the term cache used by course selection; reusing its key
  // would merge two unrelated provenance records and make retained data look
  // absent after a failed refresh.
  'jwglxt-school-schedule': Object.freeze({
    label: '全校课表',
    routes: Object.freeze([
      Object.freeze({ code: 'N219933', path: 'design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N219933&layout=default' }),
    ]),
  }),
  'weekly-schedule': Object.freeze({
    label: '按周课表',
    routes: Object.freeze([
      Object.freeze({ code: 'N2154', path: 'kbcx/xskbcxZccx_cxXskbcxIndex.html?gnmkdm=N2154&layout=default' }),
    ]),
  }),
  thesis: Object.freeze({
    label: '毕业设计与论文成绩',
    routes: Object.freeze([
      Object.freeze({ code: 'N532530', path: 'xsbysjgl/xsxt_cxXsxtIndex.html?gnmkdm=N532530&layout=default' }),
      Object.freeze({ code: 'N532540', path: 'xsbysjgl/xsgczl_cxXsgczlIndex.html?gnmkdm=N532540&layout=default' }),
      Object.freeze({ code: 'N532560', path: 'xsbysjgl/cjck_cxCjckIndex.html?gnmkdm=N532560&layout=default' }),
      Object.freeze({ code: 'N532566', path: 'xsbysjgl/xsxtgjzxg_cxXsxtgjzxgsqIndex.html?gnmkdm=N532566&layout=default' }),
    ]),
  }),
  'profile-extra': Object.freeze({
    label: '档案补充信息',
    routes: Object.freeze([
      Object.freeze({ code: 'N100801', path: 'xsxxxggl/xsgrxxwh_cxXsgrxx.html?gnmkdm=N100801&layout=default' }),
      Object.freeze({ code: 'N100802', path: 'xsxxxggl/xsjhrxxcj_cxXsjhrxxcjIndex.html?gnmkdm=N100802&layout=default' }),
      Object.freeze({ code: 'N100808', path: 'xsxxxggl/xsgrxxwh_cxXsGrxxxgIndex.html?gnmkdm=N100808&layout=default' }),
    ]),
  }),
  // These pages expose already-submitted application/status rows. THEIA may
  // read the page and its read-only grid, but never invokes the action
  // buttons, confirmation endpoints, uploads, or mutation forms.
  'academic-workflows': Object.freeze({
    label: '学业申请与审核状态',
    routes: Object.freeze([
      Object.freeze({ code: 'N151530', path: 'kcthgl/xskcthsq_cxXskcthIndex.html?sqlx=xnkc&gnmkdm=N151530&layout=default' }),
      Object.freeze({ code: 'N151540', path: 'kcthgl/xskcthsq_cxXskcthIndex.html?sqlx=xnxfjd&gnmkdm=N151540&layout=default' }),
      Object.freeze({ code: 'N151550', path: 'kcthgl/xskcthsq_cxXskcthIndex.html?sqlx=xwkcxfjd&gnmkdm=N151550&layout=default' }),
      Object.freeze({ code: 'N306115', path: 'dxyyxfrdgl/dxyyxfrdsq_cxDxyyxfrdsqIndex.html?doType=details&gnmkdm=N306115&layout=default' }),
      Object.freeze({ code: 'N306512', path: 'cjjfgl/cjjfsq_cxCjjfsqIndex.html?gnmkdm=N306512&layout=default' }),
      Object.freeze({ code: 'N307010', path: 'cjjglx/cjjglxsq_cxCjjglxsqIndex.html?gnmkdm=N307010&layout=default' }),
    ]),
  }),
  'student-status': Object.freeze({
    label: '学籍与专业状态',
    routes: Object.freeze([
      Object.freeze({ code: 'N102020', path: 'xjyd/xjydsq_cxXjydsq.html?doType=details&gnmkdm=N102020&layout=default' }),
      Object.freeze({ code: 'N106204', path: 'xszzy/xszzysqgl_cxXszzysqIndex.html?doType=details&gnmkdm=N106204&layout=default' }),
    ]),
  }),
  'student-workflows': Object.freeze({
    label: '学生事务申请状态',
    routes: Object.freeze([
      Object.freeze({ code: 'N106005', path: 'xszbbgl/xszbbgl_cxXszbbsqIndex.html?doType=details&gnmkdm=N106005&layout=default' }),
    ]),
  }),
  'selection-workflows': Object.freeze({
    label: '选课与报名状态',
    routes: Object.freeze([
      Object.freeze({ code: 'N1053', path: 'fxgl/fxbm_cxXsfxbmIndex.html?gnmkdm=N1053&layout=default' }),
      Object.freeze({ code: 'N1056', path: 'cxbm/cxbm_cxXscxbmIndex.html?gnmkdm=N1056&layout=default' }),
      Object.freeze({ code: 'N2511', path: 'jxrwbmgl/jxrwxmbm_cxJxrwxmbmIndex.html?gnmkdm=N2511&layout=default' }),
      Object.freeze({ code: 'N253512', path: 'xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default' }),
    ]),
  }),
  evaluation: Object.freeze({
    label: '教学评价状态',
    routes: Object.freeze([
      Object.freeze({ code: 'N401605', path: 'xspjgl/xspj_cxXspjIndex.html?doType=details&gnmkdm=N401605&layout=default' }),
    ]),
  }),
})

export const JWGLXT_EXTRA_DOMAIN_NAMES = Object.freeze(Object.keys(JWGLXT_EXTRA_DOMAINS))
// These menu pages duplicate the canonical profile/schedule/selection data or
// expose low-value workflow shells. Keep the legacy names available only for
// snapshot migration and parser compatibility; they are no longer fetched,
// indexed, or exposed through the user-facing data API.
export const JWGLXT_REMOVED_EXTRA_DOMAIN_NAMES = Object.freeze([
  // These two domains are deliberately outside THEIA's local data model.
  // They must be discarded during snapshot migration as well as rejected from
  // new reads, otherwise an old cache can keep surfacing data we no longer
  // support.
  'academic-warning',
  'thesis',
  'jwglxt-school-schedule',
  'weekly-schedule',
  'profile-extra',
  'academic-workflows',
  'student-status',
  'student-workflows',
  'selection-workflows',
  'evaluation',
])
export const JWGLXT_IGNORED_EXTRA_DOMAIN_NAMES = Object.freeze([
  'academic-warning',
  'thesis',
])
export const JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES = Object.freeze(
  JWGLXT_EXTRA_DOMAIN_NAMES.filter((domain) => !JWGLXT_REMOVED_EXTRA_DOMAIN_NAMES.includes(domain)),
)
export const JWGLXT_EXTRA_PARSER_VERSION = 'jwglxt-extra/v5'
