"use client";

import { useMemo, useState } from "react";
import ImportExistingData from "./import-existing-data";

const tabs = [
  ["dashboard","Dashboard"],
  ["projects","Projects"],
  ["papers","Papers"],
  ["notes","Research Notes"],
  ["star","STAR Experiences"],
  ["jobs","Job Tracker"],
  ["calendar","Calendar"],
  ["ai","AI Assistant"],
  ["settings","Settings"]
];

const demo = {
  tasks:[
    {id:1,title:"Figure 4 수정사항 정리",group:"Research",done:false,date:"2026-08-09"},
    {id:2,title:"논문 검토 의견 반영",group:"Research",done:true,date:"2026-08-09"},
    {id:3,title:"지원 직무 경험 매칭",group:"Career",done:false,date:"2026-08-10"},
    {id:4,title:"미팅 자료 준비",group:"Research",done:false,date:"2026-08-11"}
  ],
  projects:[
    {name:"Hydrogen Storage Alloy",progress:82,status:"Active",next:"Manuscript refinement"},
    {name:"CNT Growth Mechanism",progress:64,status:"Active",next:"Discussion rewrite"},
    {name:"Battery Materials",progress:30,status:"Planning",next:"Literature organization"}
  ],
  papers:[
    {title:"Hydrogen-storage alloy screening",status:"Manuscript",progress:78,deadline:"2026-08-20"},
    {title:"CNT catalyst mechanism study",status:"Analysis",progress:62,deadline:"2026-08-28"},
    {title:"Battery review project",status:"Planning",progress:20,deadline:"2026-09-10"}
  ],
  notes:[
    {title:"Figure 4 interpretation",body:"Integrated screening criteria and composition selection logic.",tag:"Paper"},
    {title:"CNT growth discussion",body:"Connect adsorption, mobility and sulfur-content-dependent growth behavior.",tag:"Research"},
    {title:"Career note",body:"Translate research problem solving into semiconductor process language.",tag:"Career"}
  ],
  experiences:[
    {title:"수율 개선 프로젝트",body:"S: 반복 불량 발생\nT: 주요 원인 후보 도출\nA: 데이터 전처리와 변수 비교\nR: 개선 우선순위 제안",tag:"Problem Solving"},
    {title:"연구 워크스페이스 구축",body:"S: 일정·논문·취업 기록이 분산\nT: 하나의 시스템으로 통합\nA: Next.js/Supabase 기반 구조 설계\nR: 다기기 동기화 가능한 개인 도구 구축",tag:"AI / Productivity"}
  ],
  jobs:[
    {company:"SK hynix",role:"P&T / Manufacturing",stage:"Preparing",deadline:"2026-09"},
    {company:"Samsung Electronics",role:"Semiconductor Process",stage:"Researching",deadline:"TBD"},
    {company:"LG Energy Solution",role:"R&D",stage:"Archive",deadline:"TBD"}
  ]
};

export default function Page(){
  const [tab,setTab]=useState("dashboard");
  const [tasks,setTasks]=useState(demo.tasks);
  const [query,setQuery]=useState("");

  return <div className="app">
    <aside className="sidebar">
      <div className="brand">
        <div className="mark">R</div>
        <div>
          <b>Research Workspace</b>
          <span>PUBLIC PORTFOLIO DEMO</span>
        </div>
      </div>

      <nav>
        {tabs.map(([key,label])=>
          <button key={key} className={tab===key?"nav active":"nav"} onClick={()=>setTab(key)}>{label}</button>
        )}
      </nav>

      <div className="sidebarFooter">
        <div className="privacy">Demo data only</div>
        <div className="tiny">Real personal data is stored separately.</div>
      </div>
    </aside>

    <main className="main">
      <header>
        <div>
          <h1>{tabs.find(x=>x[0]===tab)?.[1]}</h1>
          <p>Research · Career · Experience · AI workflow</p>
        </div>
        <span className="badge">v1.0</span>
      </header>

      <div className="demoBanner">
        이 공개 버전은 포트폴리오용 가상 데이터만 사용합니다. 실제 개인 일정과 연구 정보는 별도 비공개 앱/DB에서 관리합니다.
      </div>

      {tab==="dashboard" && <Dashboard tasks={tasks}/>}
      {tab==="projects" && <Projects/>}
      {tab==="papers" && <Papers/>}
      {tab==="notes" && <Notes/>}
      {tab==="star" && <Star/>}
      {tab==="jobs" && <Jobs/>}
      {tab==="calendar" && <Calendar tasks={tasks}/>}
      {tab==="ai" && <AI/>}
      {tab==="settings" && <Settings/>}
    </main>
  </div>
}

function Dashboard({tasks}){
  const left=tasks.filter(x=>!x.done).length;
  return <>
    <section className="hero panel">
      <div>
        <span className="eyebrow">WHY THIS EXISTS</span>
        <h2>연구자의 흩어진 업무를 하나의 워크스페이스로</h2>
        <p>연구 일정, 논문 진행, 연구 노트, STAR 경험, 취업 준비, AI 보조 기능을 하나의 흐름으로 연결하는 개인 생산성 플랫폼입니다.</p>
      </div>
    </section>

    <div className="grid4">
      <KPI label="Open Tasks" value={left}/>
      <KPI label="Projects" value={demo.projects.length}/>
      <KPI label="Papers" value={demo.papers.length}/>
      <KPI label="Job Targets" value={demo.jobs.length}/>
    </div>

    <div className="two">
      <section className="panel section">
        <SectionTitle title="Today's Tasks" sub="우선 처리할 업무"/>
        {tasks.filter(x=>x.date==="2026-08-09").map(x=><TaskRow key={x.id} item={x}/>)}
      </section>

      <section className="panel section">
        <SectionTitle title="Paper Progress" sub="현재 원고 진행 상황"/>
        {demo.papers.slice(0,2).map(x=><ProgressRow key={x.title} label={x.title} value={x.progress} status={x.status}/>)}
      </section>
    </div>

    <div className="two">
      <section className="panel section">
        <SectionTitle title="Research Projects" sub="프로젝트별 다음 행동"/>
        {demo.projects.map(x=><div className="projectRow" key={x.name}><div><b>{x.name}</b><span>{x.next}</span></div><strong>{x.progress}%</strong></div>)}
      </section>
      <section className="panel section">
        <SectionTitle title="Recent Experience" sub="자소서로 연결할 경험"/>
        {demo.experiences.slice(0,2).map(x=><div className="miniCard" key={x.title}><b>{x.title}</b><span>{x.tag}</span></div>)}
      </section>
    </div>
  </>;
}

function Projects(){
  return <div className="cards">
    {demo.projects.map(x=><article className="panel card" key={x.name}>
      <div className="cardTop"><div><span className="eyebrow">{x.status}</span><h3>{x.name}</h3></div><strong>{x.progress}%</strong></div>
      <div className="progress"><i style={{width:`${x.progress}%`}}/></div>
      <p><b>Next:</b> {x.next}</p>
      <div className="metaLine"><span>Tasks</span><span>Papers</span><span>Notes</span><span>Meetings</span></div>
    </article>)}
  </div>;
}

function Papers(){
  return <div className="cards">
    {demo.papers.map(x=><article className="panel card" key={x.title}>
      <div className="cardTop"><div><span className="eyebrow">{x.status}</span><h3>{x.title}</h3></div><strong>{x.progress}%</strong></div>
      <div className="progress"><i style={{width:`${x.progress}%`}}/></div>
      <p>Deadline · {x.deadline}</p>
      <div className="metaLine"><span>Figures</span><span>Manuscript</span><span>Review Notes</span><span>Next Action</span></div>
    </article>)}
  </div>;
}

function Notes(){
  return <div className="cards">
    {demo.notes.map(x=><article className="panel card" key={x.title}>
      <span className="eyebrow">{x.tag}</span><h3>{x.title}</h3><p>{x.body}</p>
    </article>)}
  </div>;
}

function Star(){
  return <div className="cards">
    {demo.experiences.map(x=><article className="panel card" key={x.title}>
      <div className="cardTop"><h3>{x.title}</h3><span className="badge">{x.tag}</span></div>
      <p className="pre">{x.body}</p>
      <button className="secondary">자소서 소재로 변환</button>
    </article>)}
  </div>;
}

function Jobs(){
  return <div className="panel tableWrap">
    <div className="tableHead"><span>Company</span><span>Role</span><span>Stage</span><span>Deadline</span></div>
    {demo.jobs.map(x=><div className="tableRow" key={x.company}><b>{x.company}</b><span>{x.role}</span><span className="badge">{x.stage}</span><span>{x.deadline}</span></div>)}
  </div>;
}

function Calendar({tasks}){
  const days=Array.from({length:31},(_,i)=>i+1);
  const lead=6; // Aug 2026 starts on Saturday
  const cells=[...Array(lead).fill(null),...days];
  return <section className="panel calendar">
    {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(x=><b className="dow" key={x}>{x}</b>)}
    {cells.map((d,i)=>d===null?<div className="cal muted" key={i}/>:<div className="cal" key={i}><strong>{d}</strong>{tasks.filter(x=>x.date===`2026-08-${String(d).padStart(2,"0")}`).map(x=><div className={x.done?"event done":"event"} key={x.id}>{x.title}</div>)}</div>)}
  </section>;
}

function AI(){
  return <div className="aiGrid">
    <AIBox title="Paper Summary" desc="논문 PDF를 넣으면 목적, 방법, 핵심 결과를 구조화해서 정리하는 기능을 연결할 예정입니다." action="PDF 분석"/>
    <AIBox title="STAR → Cover Letter" desc="저장된 경험을 직무별 자기소개서 소재로 재구성하는 기능을 연결할 예정입니다." action="문장 생성"/>
    <AIBox title="Research Writing" desc="Figure 설명, Discussion 정리, 메일 초안 등 연구 글쓰기를 보조하는 기능입니다." action="초안 작성"/>
  </div>;
}

function Settings(){
  return <>
    <section className="panel section">
      <SectionTitle title="Architecture" sub="포트폴리오에 보여줄 핵심 설계"/>
      <div className="arch">
        <div><b>Public App</b><span>GitHub + Vercel</span></div>
        <div className="arrow">→</div>
        <div><b>Private App</b><span>Authenticated workspace</span></div>
        <div className="arrow">→</div>
        <div><b>Supabase</b><span>PostgreSQL + RLS</span></div>
      </div>
      <p className="mutedText">공개 소스 코드와 실제 개인 데이터를 분리하고, 사용자별 접근 제어를 통해 데이터가 섞이지 않도록 설계합니다.</p>
    </section>
    <ImportExistingData/>
  </>;
}

function KPI({label,value}){return <div className="panel kpi"><span>{label}</span><b>{value}</b></div>}
function SectionTitle({title,sub}){return <div className="sectionTitle"><div><h3>{title}</h3><p>{sub}</p></div></div>}
function TaskRow({item}){return <div className={item.done?"task done":"task"}><span className="check">{item.done?"✓":""}</span><b>{item.title}</b><small>{item.group}</small></div>}
function ProgressRow({label,value,status}){return <div className="progressRow"><div><b>{label}</b><span>{status}</span></div><strong>{value}%</strong><div className="progress"><i style={{width:`${value}%`}}/></div></div>}
function AIBox({title,desc,action}){return <article className="panel aiBox"><span className="eyebrow">AI WORKFLOW</span><h3>{title}</h3><p>{desc}</p><button className="secondary">{action}</button></article>}
