import { promises as fs } from 'node:fs'
import HTTP from '@koishijs/plugin-http'
import { Context } from 'koishi'
import { normalizeConfig, type Config } from '../src/config'
import { EhHttpClient } from '../src/services/http'
const config = normalizeConfig({ site:'e-hentai', ehentaiMemberId:'4828133', ehentaiPassHash:'6887996e40daeae0d9747a5f86875ab', requestInterval:1000, downloadTimeout:60, downloadPath:process.cwd() } as Config)
async function main(){
  const ctx = new Context(); ctx.plugin(HTTP); await new Promise(r=>setTimeout(r,300))
  const http = new EhHttpClient(ctx, config)
  const { html } = await http.fetchText('https://e-hentai.org/?f_search=language%3Achinese')
  await fs.mkdir('/tmp/eh',{recursive:true}); await fs.writeFile('/tmp/eh/search.html', html)
  const links = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map(m=>m[1])
  console.log('css:', links)
  for (const href of links.slice(0,4)) {
    const url = href.startsWith('http') ? href : 'https://e-hentai.org'+href
    const css = await http.fetchText(url).then(r=>r.html).catch(e=>String(e))
    await fs.writeFile('/tmp/eh/'+url.split('/').pop(), css)
  }
}
void main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)})
