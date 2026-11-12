/** dsh-wpac 的宿主半边：人格在 lib/inject6.js，浏览器半边在 lib/client.js。
 *
 * 这个入口故意是空的。profile 的 Loader 里有一行 `name: 'dsh-wpac'`，
 * 它的作用只有一个：让 DSH 的客户端模块系统扫到这个包的 `dsh.client`，
 * 从而把 `lib/client.js`（结构确认弹窗）发给页面。行一挂上，apply 就会跑，
 * 所以这里必须是空的——真正的人格注入只该发生在 wpac 预设上下文里
 * （预设里的 `dsh-wpac/inject` 行）。
 */
export function apply() {}
