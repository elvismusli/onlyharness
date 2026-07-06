# OnlyHarness · Проверенный каталог харнесов, skills и workflow — июль 2026

**255 позиций** · Данные верифицированы через GitHub API **2026-07-05** (звёзды, дата последнего пуша, не-архивность).
Дополнительно: deep-research workflow (104 агента, 576 tool-вызовов) с adversarial-верификацией ключевых позиций голосованием 3-0.

**Критерии включения:** ≥500 звёзд, живая активность (почти все — пуш в 2026), реальное использование/известный автор.
Позиции с пометкой «классика 2025» — менее активны, но остаются референсными.

**Содержание:**
1. [Официальные ресурсы Anthropic](#1-официальные-ресурсы-anthropic) — 11
2. [Awesome-списки и каталоги](#2-awesome-списки-и-каталоги) — 24
3. [Skills: фреймворки и большие коллекции](#3-skills-фреймворки-и-большие-коллекции) — 17
4. [Skills-хиты (одиночные, проверенные звёздами)](#4-skills-хиты-одиночные-проверенные-звёздами) — 17
5. [Доменные skills-пакеты](#5-доменные-skills-пакеты) — 18
6. [Субагенты и агентские команды](#6-субагенты-и-агентские-команды) — 7
7. [Плагины, команды, конфиги](#7-плагины-команды-конфиги) — 15
8. [Spec-driven и workflow-методологии](#8-spec-driven-и-workflow-методологии) — 19
9. [Оркестрация и meta-harnesses](#9-оркестрация-и-meta-harnesses) — 16
10. [Память и контекст-инжиниринг](#10-память-и-контекст-инжиниринг) — 18
11. [Hooks, безопасность, наблюдаемость](#11-hooks-безопасность-наблюдаемость) — 10
12. [MCP-серверы (must-have)](#12-mcp-серверы-must-have) — 24
13. [Harnesses: сами агенты (терминальные и автономные)](#13-harnesses-сами-агенты-терминальные-и-автономные) — 19
14. [Инфраструктура вокруг харнесов](#14-инфраструктура-вокруг-харнесов) — 14
15. [Гайды и обучение](#15-гайды-и-обучение) — 14
16. [Смежные фреймворки (бонус)](#16-смежные-фреймворки-бонус) — 12

## 1. Официальные ресурсы Anthropic

*Первоисточник: сам харнес, официальные skills и плагины.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 1 | [anthropics/claude-code](https://github.com/anthropics/claude-code) | 136.2k | 2026-07-03 | Сам харнес Claude Code — эталон терминального кодинг-агента |
| 2 | [anthropics/skills](https://github.com/anthropics/skills) | 158.3k | 2026-07-01 | Официальный репозиторий Agent Skills (docx/pptx/xlsx/pdf и др.) — стандарт формата skills |
| 3 | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | 31.5k | 2026-07-04 | Официальный каталог качественных плагинов Claude Code, управляется Anthropic |
| 4 | [anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community) | 251 | 2026-07-04 | Официальный community-маркетплейс: ~750+ плагинов, синк каждую ночь |
| 5 | [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks) | 46.4k | 2026-07-02 | Ноутбуки-рецепты по работе с Claude: RAG, tool use, агенты |
| 6 | [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python) | 7.5k | 2026-07-04 | Python SDK для сборки собственных агентов на движке Claude Code |
| 7 | [anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript) | 1.6k | 2026-07-03 | TypeScript SDK того же движка |
| 8 | [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) | 8.3k | 2026-07-04 | Официальный GitHub Action: Claude Code в CI/PR |
| 9 | [anthropics/claude-code-security-review](https://github.com/anthropics/claude-code-security-review) | 5.5k | 2026-02-11 | AI security-ревью изменений кода как GitHub Action |
| 10 | [anthropics/prompt-eng-interactive-tutorial](https://github.com/anthropics/prompt-eng-interactive-tutorial) | 36.9k | 2026-03-01 | Интерактивный учебник промпт-инжиниринга от Anthropic |
| 11 | [anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts) | 17.2k | 2026-05-28 | Готовые стартовые проекты на API Claude |

## 2. Awesome-списки и каталоги

*Мета-уровень: списки, из которых можно черпать дальше.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 12 | [x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) | 141.5k | 2026-07-03 | Слитые системные промпты всех AI-инструментов — учебник по устройству харнесов |
| 13 | [Shubhamsaboo/awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps) | 116.5k | 2026-06-15 | 100+ рабочих приложений с агентами и RAG |
| 14 | [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | 90.3k | 2026-07-04 | Главный список MCP-серверов (+ glama.ai каталог) |
| 15 | [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 66.8k | 2026-05-22 | Курируемый список Claude Skills от Composio |
| 16 | [VoltAgent/awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills) | 50.9k | 2026-06-24 | 5400+ skills OpenClaw, отфильтрованы и категоризированы |
| 17 | [asgeirtj/system_prompts_leaks](https://github.com/asgeirtj/system_prompts_leaks) | 48.3k | 2026-07-04 | Извлечённые системные промпты Claude/GPT/Gemini, включая Claude Code |
| 18 | [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | 48.1k | 2026-07-05 | Классический awesome по Claude Code: команды, workflows, инструменты |
| 19 | [sickn33/antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills) | 42.3k | 2026-07-04 | Устанавливаемая библиотека 1800+ skills для CC/Cursor/Codex/Gemini |
| 20 | [PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) | 40.2k | 2026-05-30 | Крупнейшая коллекция .cursorrules |
| 21 | [github/awesome-copilot](https://github.com/github/awesome-copilot) | 36.2k | 2026-07-03 | Официальный: инструкции, агенты и skills для GitHub Copilot |
| 22 | [hesamsheikh/awesome-openclaw-usecases](https://github.com/hesamsheikh/awesome-openclaw-usecases) | 31.5k | 2026-03-24 | Комьюнити-коллекция реальных сценариев OpenClaw |
| 23 | [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | 27.2k | 2026-06-30 | 1497+ skills, вкл. официальные от Anthropic/Vercel/Stripe/Cloudflare — верифицирован adversarial-проверкой 3-0 |
| 24 | [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | 22.9k | 2026-06-24 | 154+ субагентов в 10 категориях — верифицирован 3-0 |
| 25 | [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | 13.9k | 2026-04-28 | Ещё один живой список Claude Skills |
| 26 | [yzfly/Awesome-MCP-ZH](https://github.com/yzfly/Awesome-MCP-ZH) | 7.4k | 2026-07-03 | Китайский каталог MCP — крупнейший в CN-сегменте |
| 27 | [heilcheng/awesome-agent-skills](https://github.com/heilcheng/awesome-agent-skills) | 5.9k | 2026-04-05 | Туториалы и директории по Agent Skills |
| 28 | [appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers) | 5.7k | 2026-05-06 | Альтернативный список MCP |
| 29 | [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers) | 4.2k | 2026-07-03 | Список MCP + mcpservers.org |
| 30 | [jaw9c/awesome-remote-mcp-servers](https://github.com/jaw9c/awesome-remote-mcp-servers) | 1.1k | 2026-06-23 | Курируемый список remote MCP |
| 31 | [jamesmurdza/awesome-ai-devtools](https://github.com/jamesmurdza/awesome-ai-devtools) | 3.9k | 2026-06-29 | AI-инструменты разработчика, широкий охват |
| 32 | [filipecalegario/awesome-vibe-coding](https://github.com/filipecalegario/awesome-vibe-coding) | 4.9k | 2026-04-16 | Референсы по vibe coding |
| 33 | [davepoon/buildwithclaude](https://github.com/davepoon/buildwithclaude) | 3.1k | 2026-07-03 | Хаб: skills, агенты, команды, hooks, плагины в одном месте |
| 34 | [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | 2.3k | 2026-05-12 | 135 агентов + 176 плагинов + 20 hooks одним тулкитом — верифицирован 3-0 |
| 35 | [ComposioHQ/awesome-claude-plugins](https://github.com/ComposioHQ/awesome-claude-plugins) | 1.8k | 2026-05-01 | Список плагинов Claude Code |

## 3. Skills: фреймворки и большие коллекции

*Наборы навыков, устанавливаемые целиком.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 36 | [obra/superpowers](https://github.com/obra/superpowers) | 246.6k | 2026-07-02 | Главный skills-фреймворк: TDD, systematic debugging, планирование; мульти-харнес — верифицирован 3-0 |
| 37 | [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) | 187.3k | 2026-04-20 | Один CLAUDE.md по наблюдениям Карпаты об ошибках LLM-кодинга |
| 38 | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | 68.8k | 2026-07-04 | Production-инженерные skills от Эдди Османи (Google Chrome) |
| 39 | [agentskills/agentskills](https://github.com/agentskills/agentskills) | 22.1k | 2026-07-01 | Спецификация открытого стандарта Agent Skills |
| 40 | [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) | 39.6k | 2026-06-08 | Официальные skills для Obsidian от CEO Obsidian (kepano) |
| 41 | [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills) | 23.1k | 2026-07-02 | Коллекция skills от Baoyu — один из самых цитируемых CN-авторов |
| 42 | [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) | 19.9k | 2026-07-03 | 337 skills + 30 агентов + 70 команд |
| 43 | [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) | 10.4k | 2026-05-20 | 66 skills для full-stack разработчика |
| 44 | [Orchestra-Research/AI-Research-SKILLs](https://github.com/Orchestra-Research/AI-Research-SKILLs) | 10.4k | 2026-06-16 | Библиотека research/engineering skills |
| 45 | [microsoft/SkillOpt](https://github.com/microsoft/SkillOpt) | 10.6k | 2026-07-02 | Microsoft: оптимизатор, обучающий переиспользуемые NL-skills |
| 46 | [google-labs-code/stitch-skills](https://github.com/google-labs-code/stitch-skills) | 6.4k | 2026-06-29 | Google Labs: skills для Stitch MCP (дизайн) |
| 47 | [tech-leads-club/agent-skills](https://github.com/tech-leads-club/agent-skills) | 4.8k | 2026-07-04 | Валидируемый реестр skills «для профессионалов» |
| 48 | [jnMetaCode/superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) | 6.4k | 2026-06-23 | Полная китайская локализация superpowers + 6 оригинальных skills |
| 49 | [refly-ai/refly](https://github.com/refly-ai/refly) | 7.4k | 2026-03-25 | Открытый конструктор skills: описываешь workflow — получаешь skill |
| 50 | [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager) | 2.7k | 2026-07-03 | Десктоп-менеджер skills для 15+ инструментов |
| 51 | [activeloopai/hivemind](https://github.com/activeloopai/hivemind) | 1.4k | 2026-07-03 | Превращает трейсы агента в переиспользуемые skills |
| 52 | [obra/superpowers-marketplace](https://github.com/obra/superpowers-marketplace) | 1.1k | 2026-07-02 | Курируемый маркетплейс плагинов от автора superpowers |

## 4. Skills-хиты (одиночные, проверенные звёздами)

*Одна задача — одна суперспособность.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 53 | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 100.5k | 2026-07-04 | Дизайн-интеллект для UI/UX: стили, палитры, шрифты под платформы |
| 54 | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | 83.2k | 2026-07-03 | Мем-хит: −65% токенов через «пещерный» стиль общения |
| 55 | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) | 77.3k | 2026-07-04 | Код/SQL/скрипты → knowledge graph для любого агента |
| 56 | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | 73.3k | 2026-07-01 | «Ленивый сеньор»: лучший код — ненаписанный (анти-оверинжиниринг) |
| 57 | [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) | 70.7k | 2026-07-03 | Код → интерактивный обучающий граф знаний |
| 58 | [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) | 57.4k | 2026-07-04 | Пре-индексированный граф кода с автосинком для CC/Codex/Cursor |
| 59 | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | 55.9k | 2026-06-20 | Придаёт агенту «вкус» — против генеричного слопа в дизайне |
| 60 | [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach) | 50.0k | 2026-07-03 | Глаза агента в интернет: Twitter/Reddit/YouTube/GitHub без API-ключей |
| 61 | [mvanhorn/last30days-skill](https://github.com/mvanhorn/last30days-skill) | 48.8k | 2026-07-04 | Ресерч темы за 30 дней по Reddit/X/YouTube/HN + синтез |
| 62 | [blader/humanizer](https://github.com/blader/humanizer) | 27.4k | 2026-06-29 | Убирает следы AI-письма из текста (автор — сооснователь Digg) |
| 63 | [zarazhangrui/frontend-slides](https://github.com/zarazhangrui/frontend-slides) | 24.5k | 2026-06-23 | Красивые веб-слайды силами фронтенд-skills агента |
| 64 | [teng-lin/notebooklm-py](https://github.com/teng-lin/notebooklm-py) | 17.2k | 2026-07-03 | Python API + skill для Google NotebookLM |
| 65 | [alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design) | 20.8k | 2026-07-02 | HTML-native дизайн-skill: высокоточные прототипы |
| 66 | [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh) | 12.3k | 2026-01-19 | Китайская версия Humanizer |
| 67 | [twostraws/SwiftUI-Agent-Skill](https://github.com/twostraws/SwiftUI-Agent-Skill) | 4.3k | 2026-04-20 | SwiftUI-skill от Пола Хадсона (Hacking with Swift) |
| 68 | [JimLiu/baoyu-design](https://github.com/JimLiu/baoyu-design) | 2.3k | 2026-07-02 | Локальный «Claude Design» как Agent Skill |
| 69 | [samber/cc-skills-golang](https://github.com/samber/cc-skills-golang) | 2.4k | 2026-07-02 | Golang-skills от автора lo (samber) |

## 5. Доменные skills-пакеты

*Готовые профессии для агента.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 70 | [santifer/career-ops](https://github.com/santifer/career-ops) | 58.4k | 2026-07-04 | Поиск работы на Claude Code: 14 режимов, дашборд, PDF |
| 71 | [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills) | 36.2k | 2026-07-04 | Академический пайплайн: research → write → review → revise |
| 72 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | 36.0k | 2026-07-03 | Маркетинг: CRO, копирайтинг, SEO, аналитика |
| 73 | [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) | 32.7k | 2026-07-04 | Агентское видеопроизводство: 12 пайплайнов, 500+ skills |
| 74 | [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | 30.1k | 2026-07-01 | 140 научных skills: биоинформатика, химия, геномика |
| 75 | [mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills) | 24.2k | 2026-06-26 | 817 кибербез-skills, маппинг на MITRE ATT&CK/NIST |
| 76 | [Donchitos/Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) | 22.6k | 2026-05-21 | Геймдев-студия: 49 агентов, 72 workflow-skills |
| 77 | [phuryn/pm-skills](https://github.com/phuryn/pm-skills) | 22.4k | 2026-07-03 | 100+ skills для продакт-менеджмента |
| 78 | [wanshuiyin/Auto-claude-code-research-in-sleep](https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep) | 13.0k | 2026-07-03 | ARIS: автономный ML-ресерч «пока спишь» |
| 79 | [AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo) | 10.5k | 2026-06-22 | SEO: 25 суб-skills + 18 суб-агентов |
| 80 | [AgriciDaniel/claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian) | 8.6k | 2026-05-28 | Самоорганизующийся «второй мозг» в Obsidian |
| 81 | [trailofbits/skills](https://github.com/trailofbits/skills) | 6.0k | 2026-07-01 | Security-ресерч и аудит от Trail of Bits |
| 82 | [SamurAIGPT/Generative-Media-Skills](https://github.com/SamurAIGPT/Generative-Media-Skills) | 3.7k | 2026-06-22 | Генеративные медиа: картинки/видео/аудио |
| 83 | [nowork-studio/NotFair](https://github.com/nowork-studio/NotFair) | 3.0k | 2026-06-24 | SEO/GEO/Google Ads/Meta Ads пакет |
| 84 | [aaron-he-zhu/aaron-marketing-skills](https://github.com/aaron-he-zhu/aaron-marketing-skills) | 2.3k | 2026-07-03 | 69 маркетинг-skills в 4 дисциплинах |
| 85 | [data-goblin/power-bi-agentic-development](https://github.com/data-goblin/power-bi-agentic-development) | 762 | 2026-07-03 | Power BI разработка через агентов (автор — MVP Kurt Buhler) |
| 86 | [quant-sentiment-ai/claude-equity-research](https://github.com/quant-sentiment-ai/claude-equity-research) | 621 | 2026-04-21 | Институциональный equity research плагином |
| 87 | [romainsimon/paperasse](https://github.com/romainsimon/paperasse) | 2.2k | 2026-05-13 | Французская бюрократия: бухгалтер, нотариус и др. |

## 6. Субагенты и агентские команды

*Роли и оркестрируемые команды для харнесов.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 88 | [wshobson/agents](https://github.com/wshobson/agents) | 37.5k | 2026-06-29 | Мульти-харнес маркетплейс агентов/плагинов — стандарт де-факто |
| 89 | [jnMetaCode/agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) | 16.6k | 2026-07-01 | 266 экспертных ролей для 18 инструментов, 20 отделов |
| 90 | [contains-studio/agents](https://github.com/contains-studio/agents) | 12.4k | 2025-07-28 | Агенты студии contains: каждый отдел — по агенту (классика 2025) |
| 91 | [revfactory/harness](https://github.com/revfactory/harness) | 8.2k | 2026-06-10 | Мета-skill: проектирует доменные команды агентов и генерит их |
| 92 | [vijaythecoder/awesome-claude-agents](https://github.com/vijaythecoder/awesome-claude-agents) | 4.3k | 2025-10-30 | Оркестрированная dev-команда субагентов (классика 2025) |
| 93 | [Gentleman-Programming/agent-teams-lite](https://github.com/Gentleman-Programming/agent-teams-lite) | 1.2k | 2026-03-26 | Оркестратор + 9 субагентов для SDD |
| 94 | [pcliangx/AppGenesisForge](https://github.com/pcliangx/AppGenesisForge) | 573 | 2026-07-03 | 19 ролей со stage-гейтами и обязательными чек-поинтами |

## 7. Плагины, команды, конфиги

*Расширение харнеса: slash-команды, плагины, готовые сетапы.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 95 | [garrytan/gstack](https://github.com/garrytan/gstack) | 119.3k | 2026-06-25 | Сетап Гарри Тана (YC): 23 инструмента-роли от CEO до QA |
| 96 | [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) | 28.5k | 2026-07-05 | CLI-конфигуратор + aitmpl.com: сотни шаблонов, агентов, команд |
| 97 | [farion1231/cc-switch](https://github.com/farion1231/cc-switch) | 113.0k | 2026-07-03 | Десктоп-менеджер провайдеров/конфигов для CC/Codex/OpenCode/Gemini |
| 98 | [cursor/community-plugins](https://github.com/cursor/community-plugins) | 4.0k | 2026-06-09 | Официальный репозиторий комьюнити-плагинов Cursor |
| 99 | [jeremylongshore/claude-code-plugins-plus-skills](https://github.com/jeremylongshore/claude-code-plugins-plus-skills) | 2.5k | 2026-07-04 | 425 плагинов, 2810 skills, 200 агентов (tonsofskills.com) |
| 100 | [notlikeDev/CCPlugins](https://github.com/notlikeDev/CCPlugins) | 2.7k | 2026-06-26 | Фреймворк готовых команд «чтобы не печатать одно и то же» |
| 101 | [qdhenry/Claude-Command-Suite](https://github.com/qdhenry/Claude-Command-Suite) | 1.3k | 2026-03-01 | Профессиональные slash-команды со структурными workflow |
| 102 | [CloudAI-X/claude-workflow-v2](https://github.com/CloudAI-X/claude-workflow-v2) | 1.4k | 2026-06-23 | Универсальный workflow-плагин: агенты+skills+hooks+команды |
| 103 | [numman-ali/n-skills](https://github.com/numman-ali/n-skills) | 1.0k | 2026-05-12 | Курируемый маркетплейс плагинов (CC/Codex/openskills) |
| 104 | [carlrannaberg/claudekit](https://github.com/carlrannaberg/claudekit) | 730 | 2026-03-31 | Тулкит команд, hooks и утилит |
| 105 | [sangrokjung/claude-forge](https://github.com/sangrokjung/claude-forge) | 772 | 2026-06-30 | 11 агентов, 36 команд, 15 skills одним фреймворком |
| 106 | [seulee26/mckinsey-pptx](https://github.com/seulee26/mckinsey-pptx) | 502 | 2026-04-24 | McKinsey-стиль PPTX: 40 шаблонов слайдов + субагент |
| 107 | [fcakyon/claude-codex-settings](https://github.com/fcakyon/claude-codex-settings) | 767 | 2026-07-01 | Боевой сетап CC+Codex: skills, плагины, hooks |
| 108 | [jarrodwatts/claude-code-config](https://github.com/jarrodwatts/claude-code-config) | 1.1k | 2026-01-21 | Публичный конфиг инженера Abstract: rules, hooks, агенты |
| 109 | [xu-xiang/everything-claude-code-zh](https://github.com/xu-xiang/everything-claude-code-zh) | 1.6k | 2026-03-05 | CN-перевод everything-claude-code: полный конфиг-набор |

## 8. Spec-driven и workflow-методологии

*Как вести агента: спеки, планы, задачи.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 110 | [github/spec-kit](https://github.com/github/spec-kit) | 118.1k | 2026-07-02 | Официальный тулкит GitHub по Spec-Driven Development |
| 111 | [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) | 64.7k | 2026-05-31 | GSD: мета-промптинг + контекст-инжиниринг + SDD (автор TÂCHES) |
| 112 | [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) | 50.1k | 2026-07-05 | BMAD: agile-метод для AI-разработки, агентные роли |
| 113 | [eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master) | 27.8k | 2026-04-28 | Task Master: AI-таск-менеджмент для Cursor/Windsurf/Roo |
| 114 | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | 24.5k | 2026-07-03 | Crash-proof планирование в markdown-файлах для долгих задач |
| 115 | [coleam00/context-engineering-intro](https://github.com/coleam00/context-engineering-intro) | 13.6k | 2026-03-16 | Интро в контекст-инжиниринг + PRP-шаблоны |
| 116 | [snarktank/ai-dev-tasks](https://github.com/snarktank/ai-dev-tasks) | 7.8k | 2025-11-05 | Классика: PRD → задачи → пошаговая реализация |
| 117 | [buildermethods/agent-os](https://github.com/buildermethods/agent-os) | 5.0k | 2026-05-05 | Agent OS: стандарты кодбазы + спеки для агентов |
| 118 | [OneRedOak/claude-code-workflows](https://github.com/OneRedOak/claude-code-workflows) | 3.9k | 2025-09-14 | Классика: design/security review workflows |
| 119 | [Pimzino/claude-code-spec-workflow](https://github.com/Pimzino/claude-code-spec-workflow) | 3.8k | 2025-09-07 | Requirements → Design → Tasks → Implementation (классика) |
| 120 | [gemini-cli-extensions/conductor](https://github.com/gemini-cli-extensions/conductor) | 3.6k | 2026-05-20 | Google: спецификация и план до кода в Gemini CLI |
| 121 | [gotalab/cc-sdd](https://github.com/gotalab/cc-sdd) | 3.5k | 2026-05-20 | Спеки → длительная автономная реализация, минимальный SDD-харнес |
| 122 | [Wirasm/PRPs-agentic-eng](https://github.com/Wirasm/PRPs-agentic-eng) | 2.2k | 2026-06-26 | PRP-методология для агентной инженерии |
| 123 | [gmickel/flow-next](https://github.com/gmickel/flow-next) | 650 | 2026-07-03 | SDD-плагин для CC/Codex/Factory с zero-dep трекингом задач |
| 124 | [zhu1090093659/spec_driven_develop](https://github.com/zhu1090093659/spec_driven_develop) | 912 | 2026-07-01 | SDD-workflow: архитектура-сначала, декомпозиция |
| 125 | [shotgun-sh/shotgun](https://github.com/shotgun-sh/shotgun) | 684 | 2026-06-02 | Codebase-aware спеки, чтобы агент не сходил с рельс |
| 126 | [zscole/adversarial-spec](https://github.com/zscole/adversarial-spec) | 553 | 2026-01-22 | Спека улучшается дебатами нескольких LLM |
| 127 | [shinpr/claude-code-workflows](https://github.com/shinpr/claude-code-workflows) | 513 | 2026-06-30 | Production-workflows со специализированными агентами |
| 128 | [nizos/tdd-guard](https://github.com/nizos/tdd-guard) | 2.2k | 2026-06-23 | Автоматическое принуждение к TDD через hooks |

## 9. Оркестрация и meta-harnesses

*Мультиагентные системы поверх харнесов.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 129 | [affaan-m/ECC](https://github.com/affaan-m/ECC) | 225.8k | 2026-07-04 | ECC: оптимизация производительности харнеса — skills, инстинкты, память |
| 130 | [bytedance/deer-flow](https://github.com/bytedance/deer-flow) | 76.0k | 2026-07-04 | ByteDance DeerFlow: long-horizon SuperAgent с сендбоксами и памятью |
| 131 | [ruvnet/ruflo](https://github.com/ruvnet/ruflo) | 63.1k | 2026-07-05 | ruflo (ex-claude-flow): ведущий meta-harness, swarm-оркестрация — верифицирован 3-0 |
| 132 | [zhayujie/CowAgent](https://github.com/zhayujie/CowAgent) | 45.8k | 2026-07-03 | Агент-харнес: планирует, запускает skills, самоэволюционирует |
| 133 | [Yeachan-Heo/oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) | 37.4k | 2026-07-03 | Teams-first мультиагентная оркестрация для Claude Code |
| 134 | [aden-hive/hive](https://github.com/aden-hive/hive) | 10.6k | 2026-05-29 | Production мульти-агент харнес |
| 135 | [smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad) | 8.0k | 2026-06-17 | Менеджер нескольких терминальных агентов (CC/Codex/Amp) |
| 136 | [kyegomez/swarms](https://github.com/kyegomez/swarms) | 6.9k | 2026-07-02 | Enterprise мультиагентный оркестратор |
| 137 | [omnigent-ai/omnigent](https://github.com/omnigent-ai/omnigent) | 6.2k | 2026-07-04 | Meta-harness: своп CC/Codex/Cursor как бэкендов |
| 138 | [golutra/golutra](https://github.com/golutra/golutra) | 3.7k | 2026-06-29 | Оркестрация Codex/CC/OpenClaw в автоматизации |
| 139 | [nyldn/claude-octopus](https://github.com/nyldn/claude-octopus) | 3.7k | 2026-07-03 | До 8 моделей на одну задачу — ловит слепые зоны |
| 140 | [preset-io/agor](https://github.com/preset-io/agor) | 1.3k | 2026-07-03 | Мультиплеерный canvas для сессий CC/Codex/Gemini + git worktrees |
| 141 | [yohey-w/multi-agent-shogun](https://github.com/yohey-w/multi-agent-shogun) | 1.4k | 2026-06-06 | Параллельные агенты через tmux в самурайском стиле |
| 142 | [jayminwest/overstory](https://github.com/jayminwest/overstory) | 1.3k | 2026-05-28 | Оркестрация с плагируемыми runtime-адаптерами |
| 143 | [disler/infinite-agentic-loop](https://github.com/disler/infinite-agentic-loop) | 600 | 2026-03-09 | Классика: бесконечный агентный цикл в 2 промпта |
| 144 | [swarmclawai/swarmclaw](https://github.com/swarmclawai/swarmclaw) | 601 | 2026-06-30 | Self-hosted рой автономных агентов |

## 10. Память и контекст-инжиниринг

*Чтобы агент помнил и не жёг токены.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 145 | [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) | 85.7k | 2026-07-04 | Персистентная память: сжимает сессии и инжектит контекст |
| 146 | [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | 68.4k | 2026-07-03 | Rust-прокси: −60-90% токенов на типовых dev-командах |
| 147 | [mem0ai/mem0](https://github.com/mem0ai/mem0) | 60.1k | 2026-07-03 | Универсальный memory-слой для агентов |
| 148 | [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | 56.3k | 2026-07-03 | Сжатие tool-выводов/логов/RAG перед LLM: −60-95% токенов |
| 149 | [getzep/graphiti](https://github.com/getzep/graphiti) | 28.4k | 2026-07-02 | Real-time knowledge graphs для агентной памяти |
| 150 | [topoteretes/cognee](https://github.com/topoteretes/cognee) | 26.9k | 2026-07-03 | Открытая AI-memory платформа |
| 151 | [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) | 24.5k | 2026-06-29 | Память для кодинг-агентов на реальных бенчмарках |
| 152 | [screenpipe/screenpipe](https://github.com/screenpipe/screenpipe) | 19.6k | 2026-07-04 | 24/7 запись экрана/аудио как контекст для агентов (YC S26) |
| 153 | [mksglu/context-mode](https://github.com/mksglu/context-mode) | 18.6k | 2026-07-03 | Сендбокс tool-выводов (−98%), персистентная память сессий |
| 154 | [parcadei/Continuous-Claude-v3](https://github.com/parcadei/Continuous-Claude-v3) | 3.9k | 2026-01-26 | Леджеры и handoffs через hooks: непрерывность между сессиями |
| 155 | [zilliztech/memsearch](https://github.com/zilliztech/memsearch) | 2.2k | 2026-06-30 | Markdown-память с векторным поиском (Zilliz/Milvus) |
| 156 | [coleam00/claude-memory-compiler](https://github.com/coleam00/claude-memory-compiler) | 1.2k | 2026-04-06 | Hooks собирают сессии → компилируют эволюционирующую память |
| 157 | [ClaudioDrews/memory-os](https://github.com/ClaudioDrews/memory-os) | 1.2k | 2026-06-10 | 7-слойная память на Qdrant для Hermes Agent |
| 158 | [rohitg00/pro-workflow](https://github.com/rohitg00/pro-workflow) | 2.6k | 2026-06-29 | Самокорректирующаяся память: учится на твоих правках 50+ сессий |
| 159 | [grapeot/context-infrastructure](https://github.com/grapeot/context-infrastructure) | 649 | 2026-07-03 | Персистентная память + правила + планировщик |
| 160 | [SethGammon/Citadel](https://github.com/SethGammon/Citadel) | 630 | 2026-07-03 | Операционный слой CC+Codex: память проекта, интент-роутинг |
| 161 | [raiyanyahya/recall](https://github.com/raiyanyahya/recall) | 664 | 2026-06-26 | Долговременная память, чтобы не объяснять проект заново |
| 162 | [alash3al/stash](https://github.com/alash3al/stash) | 720 | 2026-06-14 | Эпизоды/факты/рабочий контекст в Postgres |

## 11. Hooks, безопасность, наблюдаемость

*Контроль за поведением агента.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 163 | [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) | 3.8k | 2026-03-04 | Эталонное освоение hooks Claude Code (IndyDevDan) |
| 164 | [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) | 1.5k | 2026-02-08 | Real-time мониторинг агентов через hook-события |
| 165 | [kenryu42/cc-safety-net](https://github.com/kenryu42/cc-safety-net) | 1.4k | 2026-06-30 | Hook-страховка: ловит деструктивные git/fs-команды |
| 166 | [Pantheon-Security/medusa](https://github.com/Pantheon-Security/medusa) | 886 | 2026-06-24 | Security-сканер + детект компрометации .claude/ hooks |
| 167 | [severity1/claude-code-prompt-improver](https://github.com/severity1/claude-code-prompt-improver) | 1.6k | 2026-06-03 | Hook-улучшайзер промптов: «пишешь вайб — уходит точность» |
| 168 | [alibaba/open-code-review](https://github.com/alibaba/open-code-review) | 9.9k | 2026-07-03 | Гибридное код-ревью, проверено масштабом Alibaba |
| 169 | [gemini-cli-extensions/security](https://github.com/gemini-cli-extensions/security) | 788 | 2026-06-19 | Google: поиск уязвимостей в изменениях (Gemini CLI) |
| 170 | [gemini-cli-extensions/code-review](https://github.com/gemini-cli-extensions/code-review) | 519 | 2026-03-10 | Google: ревью изменений (Gemini CLI) |
| 171 | [ReflexioAI/claude-smart](https://github.com/ReflexioAI/claude-smart) | 732 | 2026-07-04 | Самоулучшение через обучение на твоих корректировках |
| 172 | [hyhmrright/brooks-lint](https://github.com/hyhmrright/brooks-lint) | 1.2k | 2026-07-02 | Ревью по 12 классическим инженерным книгам с цитатами |

## 12. MCP-серверы (must-have)

*Проверенные коннекторы для любого харнеса.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 173 | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | 88.1k | 2026-07-04 | Официальные референсные MCP-серверы |
| 174 | [upstash/context7](https://github.com/upstash/context7) | 58.6k | 2026-07-05 | Актуальная документация библиотек прямо в контекст |
| 175 | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | 34.7k | 2026-06-29 | Браузер-автоматизация от Microsoft |
| 176 | [github/github-mcp-server](https://github.com/github/github-mcp-server) | 31.2k | 2026-07-03 | Официальный GitHub MCP |
| 177 | [oraios/serena](https://github.com/oraios/serena) | 26.1k | 2026-07-03 | Семантический поиск/правка кода — IDE для агента |
| 178 | [PrefectHQ/fastmcp](https://github.com/PrefectHQ/fastmcp) | 26.0k | 2026-07-01 | Стандарт для написания MCP на Python |
| 179 | [mcp-use/mcp-use](https://github.com/mcp-use/mcp-use) | 10.2k | 2026-07-03 | Fullstack-фреймворк MCP-приложений |
| 180 | [awslabs/mcp](https://github.com/awslabs/mcp) | 9.4k | 2026-07-03 | Официальные MCP для AWS |
| 181 | [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) | 23.5k | 2026-06-11 | Blender под управлением LLM |
| 182 | [GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP) | 15.3k | 2026-07-03 | Figma-layout в контекст кодинг-агента |
| 183 | [idosal/git-mcp](https://github.com/idosal/git-mcp) | 8.2k | 2026-05-08 | Remote MCP для любого GitHub-репо против галлюцинаций |
| 184 | [AgentDeskAI/browser-tools-mcp](https://github.com/AgentDeskAI/browser-tools-mcp) | 7.3k | 2026-03-18 | Логи браузера в IDE-агента |
| 185 | [firecrawl/firecrawl-mcp-server](https://github.com/firecrawl/firecrawl-mcp-server) | 6.8k | 2026-07-04 | Официальный: скрейпинг и веб-поиск |
| 186 | [21st-dev/magic-mcp](https://github.com/21st-dev/magic-mcp) | 5.3k | 2026-02-17 | v0-подобная генерация UI в Cursor/Cline |
| 187 | [sooperset/mcp-atlassian](https://github.com/sooperset/mcp-atlassian) | 5.5k | 2026-07-05 | Confluence + Jira |
| 188 | [makenotion/notion-mcp-server](https://github.com/makenotion/notion-mcp-server) | 4.5k | 2026-06-22 | Официальный Notion MCP |
| 189 | [cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare) | 3.9k | 2026-07-01 | Официальный Cloudflare MCP |
| 190 | [homeassistant-ai/ha-mcp](https://github.com/homeassistant-ai/ha-mcp) | 3.8k | 2026-07-04 | Home Assistant MCP |
| 191 | [browserbase/mcp-server-browserbase](https://github.com/browserbase/mcp-server-browserbase) | 3.4k | 2026-07-01 | Облачный браузер + Stagehand |
| 192 | [supabase/mcp](https://github.com/supabase/mcp) | 2.8k | 2026-06-30 | Официальный Supabase MCP |
| 193 | [punkpeye/fastmcp](https://github.com/punkpeye/fastmcp) | 3.2k | 2026-07-03 | TypeScript-фреймворк MCP-серверов |
| 194 | [metorial/metorial](https://github.com/metorial/metorial) | 3.3k | 2026-07-03 | 1200+ интеграций через MCP/CLI/API |
| 195 | [AmoyLab/Unla](https://github.com/AmoyLab/Unla) | 2.2k | 2026-06-08 | MCP Gateway: превращает API в MCP на лету |
| 196 | [timescale/pg-aiguide](https://github.com/timescale/pg-aiguide) | 1.8k | 2026-06-26 | Postgres-skills и доки для AI-инструментов |

## 13. Harnesses: сами агенты (терминальные и автономные)

*Конкуренты и соседи Claude Code — для полноты каталога.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 197 | [openclaw/openclaw](https://github.com/openclaw/openclaw) | 381.6k | 2026-07-04 | Личный AI-ассистент «лобстерный путь» — самый быстрорастущий проект экосистемы |
| 198 | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | 208.9k | 2026-07-04 | Hermes: «агент, который растёт с тобой» (Nous Research) |
| 199 | [anomalyco/opencode](https://github.com/anomalyco/opencode) | 182.5k | 2026-07-05 | OpenCode: открытый кодинг-агент, главный OSS-конкурент |
| 200 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | 105.8k | 2026-07-05 | Gemini CLI от Google |
| 201 | [openai/codex](https://github.com/openai/codex) | 95.6k | 2026-07-05 | Codex CLI от OpenAI |
| 202 | [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | 79.5k | 2026-07-05 | OpenHands: AI-driven development платформа |
| 203 | [cline/cline](https://github.com/cline/cline) | 64.3k | 2026-07-05 | Cline: агент как SDK, IDE-расширение и CLI |
| 204 | [aaif-goose/goose](https://github.com/aaif-goose/goose) | 50.7k | 2026-07-05 | Goose (ex-Block): расширяемый локальный агент |
| 205 | [Aider-AI/aider](https://github.com/Aider-AI/aider) | 47.1k | 2026-05-22 | Aider: AI pair programming в терминале (классика) |
| 206 | [HKUDS/nanobot](https://github.com/HKUDS/nanobot) | 45.0k | 2026-07-04 | Лёгкий открытый агент для тулов и workflow |
| 207 | [zeroclaw-labs/zeroclaw](https://github.com/zeroclaw-labs/zeroclaw) | 32.1k | 2026-07-04 | Rust-инфраструктура автономного ассистента: быстро и всюду |
| 208 | [nanocoai/nanoclaw](https://github.com/nanocoai/nanoclaw) | 30.1k | 2026-07-04 | Контейнерная безопасная альтернатива OpenClaw |
| 209 | [sipeed/picoclaw](https://github.com/sipeed/picoclaw) | 29.6k | 2026-07-05 | Крошечный агент, деплоится куда угодно (даже на железки) |
| 210 | [charmbracelet/crush](https://github.com/charmbracelet/crush) | 26.1k | 2026-07-04 | Crush: гламурный терминальный агент от Charm |
| 211 | [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) | 25.8k | 2026-07-05 | Qwen Code: открытый терминальный агент Alibaba |
| 212 | [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode) | 25.6k | 2026-07-04 | Kilo: agentic-платформа (VS Code) |
| 213 | [kortix-ai/suna](https://github.com/kortix-ai/suna) | 19.9k | 2026-07-05 | Suna: командный AI-центр компании |
| 214 | [agent0ai/agent-zero](https://github.com/agent0ai/agent-zero) | 18.3k | 2026-07-02 | Agent Zero: органический растущий фреймворк-агент |
| 215 | [shareAI-lab/learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) | 69.8k | 2026-06-26 | «Bash is all you need»: нано-Claude Code с нуля — учебный харнес |

## 14. Инфраструктура вокруг харнесов

*Роутинг, GUI, мониторинг, песочницы.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 216 | [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router) | 35.6k | 2026-07-05 | Роутер: Claude Code поверх любых моделей |
| 217 | [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | 39.1k | 2026-07-04 | CLI-агенты как OpenAI/Gemini/Claude-совместимый API |
| 218 | [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio) | 48.1k | 2026-07-04 | AI-студия с агентами и 300+ ассистентами |
| 219 | [daytonaio/daytona](https://github.com/daytonaio/daytona) | 72.3k | 2026-06-30 | Безопасная эластичная инфраструктура для AI-кода |
| 220 | [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi) | 29.3k | 2026-07-03 | Локальный 24/7 Cowork-GUI для 20+ CLI-агентов |
| 221 | [eigent-ai/eigent](https://github.com/eigent-ai/eigent) | 14.5k | 2026-07-03 | Открытый Cowork-десктоп (CAMEL-AI) |
| 222 | [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) | 12.4k | 2026-07-03 | CC/Codex/Cursor с телефона и веба |
| 223 | [ccusage/ccusage](https://github.com/ccusage/ccusage) | 16.9k | 2026-07-05 | Анализ использования и стоимости Claude Code |
| 224 | [Maciek-roboblog/Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | 8.4k | 2026-07-05 | Real-time монитор лимитов с предсказаниями |
| 225 | [winfunc/opcode](https://github.com/winfunc/opcode) | 22.1k | 2025-10-16 | GUI-тулкит для CC (ex-Claudia): агенты, сессии |
| 226 | [NVIDIA/NemoClaw](https://github.com/NVIDIA/NemoClaw) | 21.6k | 2026-07-04 | NVIDIA: безопасный запуск Hermes/OpenClaw с managed inference |
| 227 | [googleworkspace/cli](https://github.com/googleworkspace/cli) | 29.4k | 2026-07-01 | Официальный CLI Google Workspace — идеален под агентов |
| 228 | [formkit/formkit](https://github.com/formkit/formkit) | 4.7k | 2026-06-24 | Форм-фреймворк, спроектированный под кодинг-агентов |
| 229 | [xixu-me/xget](https://github.com/xixu-me/xget) | 8.2k | 2026-07-03 | Ускоритель загрузки dev-ресурсов для агентов |

## 15. Гайды и обучение

*Как выжать максимум: проверенные материалы.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 230 | [shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice) | 61.9k | 2026-07-04 | От vibe coding к agentic engineering: практики |
| 231 | [luongnv89/claude-howto](https://github.com/luongnv89/claude-howto) | 39.2k | 2026-07-01 | Визуальный гайд с copy-paste шаблонами |
| 232 | [garrytan/gbrain](https://github.com/garrytan/gbrain) | 25.0k | 2026-07-02 | Opinionated «мозг» Гарри Тана для OpenClaw/Hermes |
| 233 | [liyupi/ai-guide](https://github.com/liyupi/ai-guide) | 16.8k | 2026-07-01 | Крупнейший CN-гайд по AI/vibe coding |
| 234 | [diet103/claude-code-infrastructure-showcase](https://github.com/diet103/claude-code-infrastructure-showcase) | 9.7k | 2026-04-17 | Живой пример инфраструктуры: авто-активация skills, hooks |
| 235 | [ykdojo/claude-code-tips](https://github.com/ykdojo/claude-code-tips) | 9.0k | 2026-07-03 | 40+ советов от базы до продвинутых |
| 236 | [ChrisWiles/claude-code-showcase](https://github.com/ChrisWiles/claude-code-showcase) | 6.0k | 2026-01-06 | Образцовый проектный конфиг: hooks, skills, CI |
| 237 | [FlorianBruniaux/claude-code-ultimate-guide](https://github.com/FlorianBruniaux/claude-code-ultimate-guide) | 5.3k | 2026-07-03 | 430K+ строк: workflows, hooks, skills, квизы |
| 238 | [zebbern/claude-code-guide](https://github.com/zebbern/claude-code-guide) | 4.4k | 2026-07-04 | От новичка до power user |
| 239 | [wesammustafa/Claude-Code-Everything-You-Need-to-Know](https://github.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know) | 2.2k | 2026-05-06 | Всё-в-одном руководство |
| 240 | [ombharatiya/ai-system-design-guide](https://github.com/ombharatiya/ai-system-design-guide) | 2.1k | 2026-06-28 | Дизайн production AI-систем и evals |
| 241 | [TheDecipherist/claude-code-mastery](https://github.com/TheDecipherist/claude-code-mastery) | 537 | 2026-05-07 | CLAUDE.md, hooks, skills, MCP — полный курс |
| 242 | [keskinonur/claude-code-ios-dev-guide](https://github.com/keskinonur/claude-code-ios-dev-guide) | 778 | 2026-01-04 | iOS-разработка с PRD-workflow и extended thinking |
| 243 | [FerroxLabs/agents-md](https://github.com/FerroxLabs/agents-md) | 610 | 2026-05-31 | Drop-in AGENTS.md: агент ведёт себя как сеньор |

## 16. Смежные фреймворки (бонус)

*Не харнесы, но рядом: сборка своих агентов и workflow.*

| # | Репозиторий | ⭐ | Обновлён | Что это |
|---|---|---|---|---|
| 244 | [langgenius/dify](https://github.com/langgenius/dify) | 147.6k | 2026-07-04 | Production-платформа агентных workflow |
| 245 | [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | 36.5k | 2026-07-05 | Стейт-машины для устойчивых агентов |
| 246 | [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) | 54.9k | 2026-07-04 | Ролевые команды агентов |
| 247 | [openai/openai-agents-python](https://github.com/openai/openai-agents-python) | 27.7k | 2026-07-04 | Официальный мультиагентный SDK OpenAI |
| 248 | [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) | 18.2k | 2026-07-05 | Агентный фреймворк «по-pydantic'овски» |
| 249 | [google/adk-python](https://github.com/google/adk-python) | 20.5k | 2026-07-03 | Google ADK: code-first агенты |
| 250 | [huggingface/smolagents](https://github.com/huggingface/smolagents) | 28.2k | 2026-06-23 | Минималистичные агенты, думающие кодом |
| 251 | [lastmile-ai/mcp-agent](https://github.com/lastmile-ai/mcp-agent) | 8.4k | 2026-01-25 | Агенты на MCP + паттерны workflow |
| 252 | [The-Pocket/PocketFlow](https://github.com/The-Pocket/PocketFlow) | 10.9k | 2026-03-27 | LLM-фреймворк в 100 строк: агенты строят агентов |
| 253 | [simstudioai/sim](https://github.com/simstudioai/sim) | 28.9k | 2026-07-04 | Визуальная сборка и оркестрация агентов |
| 254 | [FellouAI/eko](https://github.com/FellouAI/eko) | 4.9k | 2026-03-03 | Production agentic workflow на естественном языке |
| 255 | [dagucloud/dagu](https://github.com/dagucloud/dagu) | 3.6k | 2026-07-04 | Local-first workflow-движок с Web UI (YAML DAG) |
