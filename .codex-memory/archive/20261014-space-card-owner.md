# Space 卡片所有者显示

- 请求：每张 Space 卡片显示空间 Owner。
- 实现：Dashboard 描述下新增所有者图标及文本；从现有列表/创建响应的 members.role=owner 读取所有姓名。管理员和当前登录人不被推断为Owner；多Owner用中文顿号/英文逗号连接；空姓名回退邮箱，缺失资料显示“暂无信息”。长名单省略，title保存全文。
- 接口核查：列表与创建均已使用安全MEMBER_SELECT返回user姓名/邮箱，不新增请求、数据库字段或额外用户字段。
- 文件：agentwiki/apps/client/src/{api/space-types.ts,features/dashboard/Dashboard.tsx,features/dashboard/Dashboard.spec.tsx,i18n/messages.ts}。
- 验证：Dashboard41/41、client build/TypeScript、定向ESLint、diff check通过；独立只读复审无发现。项目tslib不声明Intl.ListFormat，因此采用简单本地化分隔符，未调整平台要求。
- 浏览器：真实Dashboard +本地只读Axios adapter合成数据，1440×1000与390×844；中英文、单Owner、多Owner、长名单、邮箱回退及缺失信息均检查。手机document.scrollWidth=innerWidth=390，各卡片scrollWidth=clientWidth=356。
- 图像：/tmp/agentwiki-space-owner-qa/{desktop,mobile}.png；日志：/tmp/agentwiki-space-owner-{tests,build,lint}.log。
- 预览：http://127.0.0.1:5184/e2e/fixtures/space-card-owner.html；不连接生产。共享Vite5184服务继续保留用于本地交付。
- 状态：本地实现和验收完成，尚未推送GitHub或部署。
