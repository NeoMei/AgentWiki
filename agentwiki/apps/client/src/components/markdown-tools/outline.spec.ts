import { describe,it,expect } from 'vitest';
import { outlineFor } from './outline';
describe('shared Markdown outline',()=>{
  it('excludes fences and distinguishes duplicate source headings with stable rendered slugs',()=>{
    const source='# A\n```md\n# fake\n```\n# A';
    expect(outlineFor(source)).toEqual([
      {id:'a',label:'A',level:1,from:0,to:3},
      {id:'a-1',label:'A',level:1,from:21,to:24},
    ]);
  });
  it('parses setext, formatted labels, Chinese and heading source offsets',()=>{
    expect(outlineFor('Intro\n=====\n\n## 中文 **标题**\n\n> ### Quote').map(({id,label,level,from})=>({id,label,level,from}))).toEqual([
      {id:'intro',label:'Intro',level:1,from:0},
      {id:'中文-标题',label:'中文 标题',level:2,from:13},
      {id:'quote',label:'Quote',level:3,from:29},
    ]);
  });
});
