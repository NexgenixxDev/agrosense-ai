import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  LayoutDashboard,
  Leaf,
  LogOut,
  Search,
  ShieldCheck,
  Sprout,
  Users,
  X,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import "./style.css";
type Row = Record<string, any>;
const format = (v: string) =>
  new Intl.DateTimeFormat("en-NA", {
    dateStyle: "medium",
    timeZone: "Africa/Windhoek",
  }).format(new Date(v));
const label = (v: string) => v.replaceAll("_", " ");
function App() {
  const [token, setToken] = useState(
    sessionStorage.getItem("agrosense-token") || "",
  );
  const [user, setUser] = useState<Row | null>(null);
  const [health, setHealth] = useState<Row>({});
  const [page, setPage] = useState("Overview");
  const [cases, setCases] = useState<Row[]>([]);
  const [advice, setAdvice] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [audit, setAudit] = useState<Row[]>([]);
  const [crops, setCrops] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [response, setResponse] = useState("");
  const [correction, setCorrection] = useState("");
  const [advisor, setAdvisor] = useState("advisor-demo");
  const [loginId, setLoginId] = useState("advisor-demo");
  const [showDraft, setShowDraft] = useState(false);
  async function api(
    path: string,
    method = "GET",
    body?: unknown,
    auth = token,
  ) {
    const r = await fetch("/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || "Request failed");
    return data;
  }
  const admin = user?.roles.includes("admin");
  const reviewer = user?.roles.includes("reviewer");
  async function load() {
    const me = await api("/me");
    setUser(me);
    const [all, content, catalog] = await Promise.all([
      me.roles.includes("reviewer")
        ? []
        : api(me.roles.includes("admin") ? "/admin/cases" : "/advisor/cases"),
      api(
        me.roles.includes("reviewer") || me.roles.includes("admin")
          ? "/admin/advice"
          : "/advice",
      ),
      api("/crops"),
    ]);
    setCases(all);
    setAdvice(content);
    setCrops(catalog);
    if (me.roles.includes("admin")) {
      setUsers(await api("/admin/users"));
      setAudit(await api("/admin/audit"));
    }
  }
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    api("/health")
      .then(setHealth)
      .catch(() =>
        setError("The API is unavailable. Start the backend on port 4100."),
      );
  }, []);
  useEffect(() => {
    if (token) void act(load);
  }, [token]);
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    setPhotos([]);
    if (selected)
      Promise.all(
        selected.images.map(async (i: Row) => {
          const r = await fetch(`/api/cases/${selected.id}/images/${i.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) throw new Error("Could not load photo");
          const url = URL.createObjectURL(await r.blob());
          urls.push(url);
          return url;
        }),
      )
        .then((p) => {
          if (!cancelled) setPhotos(p);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [selected?.id, token]);
  function logout() {
    void api("/auth/logout", "POST").catch(() => {});
    sessionStorage.removeItem("agrosense-token");
    setToken("");
    setUser(null);
    setSelected(null);
    setPage("Overview");
  }
  const pending = cases.filter((c) =>
    ["requested", "assigned"].includes(c.review_state),
  );
  const reviewed = cases.filter((c) => c.review_state === "responded");
  const filtered = cases.filter(
    (c) =>
      (filter === "all" || c.review_state === filter) &&
      `${c.crop} ${c.id} ${c.owner_id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  async function openCase(c: Row) {
    setSelected(await api("/cases/" + c.id));
    setResponse("");
    setCorrection("");
  }
  if (!token || !user)
    return (
      <div className="login">
        <div className="login-art">
          <div className="brand light">
            <span className="brand-icon">
              <Sprout />
            </span>
            AgroSense<span className="ai">AI</span>
          </div>
          <div>
            <span className="eyebrow">ROOTED IN LOCAL KNOWLEDGE</span>
            <h1>
              Healthier crops.
              <br />
              Stronger communities.
            </h1>
            <p>
              A clearer picture of crop health, with human expertise at every
              step.
            </p>
            <div className="landscape">
              <i />
              <i />
              <i />
              <Sprout size={100} />
            </div>
          </div>
          <small>
            Designed for farmers and agricultural advisors in Namibia.
          </small>
        </div>
        <main className="login-form">
          <span className="eyebrow">ADVISOR & ADMIN PORTAL</span>
          <h2>Welcome to your workspace</h2>
          <p>Review crop cases. Share guidance. Follow progress.</p>
          {error && (
            <div role="alert" className="notice">
              {error}
            </div>
          )}
          <div className="dev-label">
            <ShieldCheck size={18} /> Development environment
          </div>
          <label>
            Choose a development account
            <select
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
            >
              <option value="advisor-demo">
                Daniel · Agricultural advisor
              </option>
              <option value="admin-demo">Administrator</option>
              <option value="reviewer-demo">Content reviewer</option>
            </select>
          </label>
          <button
            disabled={busy || !health.development_auth}
            className="primary"
            onClick={() =>
              act(async () => {
                const r = await api("/auth/dev", "POST", { user_id: loginId });
                sessionStorage.setItem("agrosense-token", r.token);
                setToken(r.token);
              })
            }
          >
            Open workspace <ArrowRight size={18} />
          </button>
          <p className="fine">
            {health.development_auth
              ? "Demo accounts are for local testing. Sample content is clearly marked."
              : "Development sign-in is disabled or the API is unavailable. Production identity integration is pending."}
          </p>
        </main>
      </div>
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Sprout />
          </span>
          AgroSense<span className="ai">AI</span>
        </div>
        <div className="workspace-label">
          {admin
            ? "ADMINISTRATION"
            : reviewer
              ? "CONTENT WORKSPACE"
              : "ADVISOR WORKSPACE"}
        </div>
        <nav>
          {[
            { name: "Overview", icon: LayoutDashboard },
            { name: "Case queue", icon: ClipboardList },
            { name: "Guidance library", icon: BookOpen },
            ...(admin
              ? [
                  { name: "People", icon: Users },
                  { name: "Activity log", icon: ShieldCheck },
                ]
              : []),
          ]
            .filter(
              (i) =>
                !reviewer || ["Overview", "Guidance library"].includes(i.name),
            )
            .map((i) => (
              <button
                key={i.name}
                className={page === i.name ? "active" : ""}
                onClick={() => setPage(i.name)}
              >
                <i.icon size={19} />
                {i.name}
                {i.name === "Case queue" && pending.length > 0 && (
                  <b>{pending.length}</b>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="field-note">
            <Leaf size={23} />
            <strong>
              Better advice starts
              <br />
              with a closer look.
            </strong>
            <p>Every case is a farmer’s next decision.</p>
          </div>
          <div className="profile">
            <div className="avatar">{user.name[0]}</div>
            <div>
              <strong>{user.name.split(" • ")[0]}</strong>
              <small>{user.roles.join(", ")}</small>
            </div>
            <button aria-label="Sign out" className="icon" onClick={logout}>
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <span className="environment">
            <span /> Local development
          </span>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {new Intl.DateTimeFormat("en-NA", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: "Africa/Windhoek",
                }).format(new Date())}
              </span>
              <h1>
                {page === "Overview"
                  ? `Good to see you, ${user.name.split(" ")[0]}.`
                  : page}
              </h1>
              <p>
                {page === "Overview"
                  ? "A little attention today. A healthier harvest tomorrow."
                  : page === "Case queue"
                    ? "The next step in a farmer’s crop-health journey."
                    : "Locally relevant knowledge, with a traceable review history."}
              </p>
            </div>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => act(load)}
            >
              <RefreshCw size={16} className={busy ? "spin" : ""} />
              Refresh
            </button>
          </div>
          {error && (
            <div role="alert" className="notice">
              <AlertCircle size={18} />
              {error}
              <button
                className="icon"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "Overview" && (
            <>
              <section className="hero">
                <div>
                  <span className="hero-tag">
                    <span /> GROWING TOGETHER
                  </span>
                  <h2>
                    Local insight.
                    <br />
                    Lasting impact.
                  </h2>
                  <p>
                    Help farmers make their next move
                    <br />
                    with thoughtful, practical crop guidance.
                  </p>
                  <button
                    onClick={() =>
                      setPage(reviewer ? "Guidance library" : "Case queue")
                    }
                  >
                    {reviewer ? "Review guidance" : "View case queue"}
                    <ArrowRight size={18} />
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="sun" />
                  <div className="hill hill-back" />
                  <div className="hill hill-mid" />
                  <div className="hill hill-front" />
                  <div className="plant plant-one">
                    <Sprout />
                  </div>
                  <div className="plant plant-two">
                    <Sprout />
                  </div>
                  <div className="plant plant-three">
                    <Sprout />
                  </div>
                  <span className="art-caption">
                    NAMIBIA · A FIELD OF POSSIBILITY
                  </span>
                </div>
              </section>
              <section className="stats">
                {[
                  {
                    name: "Cases in your workspace",
                    value: cases.length,
                    icon: ClipboardList,
                    color: "green",
                    note: "Persisted crop submissions",
                  },
                  {
                    name: "Awaiting a response",
                    value: pending.length,
                    icon: Clock,
                    color: "amber",
                    note: "Requested or assigned reviews",
                  },
                  {
                    name: "Advisor responses",
                    value: reviewed.length,
                    icon: Check,
                    color: "blue",
                    note: "Cases with a recorded response",
                  },
                  {
                    name: "Published guidance",
                    value: advice.filter((a) => a.state === "published").length,
                    icon: BookOpen,
                    color: "green",
                    note: "Includes labelled demo content",
                  },
                ].map((s) => (
                  <article className="stat" key={s.name}>
                    <div>
                      <span>{s.name}</span>
                      <s.icon className={s.color} size={19} />
                    </div>
                    <strong>{s.value.toString().padStart(2, "0")}</strong>
                    <small>{s.note}</small>
                  </article>
                ))}
              </section>
            </>
          )}
          {((page === "Overview" && !reviewer) || page === "Case queue") && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {page === "Overview" ? "Your crop cases" : "Case queue"}
                  </h2>
                  <p>
                    {admin
                      ? "Assign requested cases to an available advisor."
                      : "Only cases assigned to you appear here."}
                  </p>
                </div>
                <span className="count">{cases.length} cases</span>
              </div>
              <div className="toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    placeholder="Search crop, farmer or case ID"
                    aria-label="Search cases"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Review status"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All review states</option>
                  <option value="requested">Review requested</option>
                  <option value="assigned">Assigned</option>
                  <option value="responded">Responded</option>
                </select>
              </div>
              {filtered.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Crop / case</th>
                        <th>Farmer</th>
                        <th>Submitted</th>
                        <th>Processing</th>
                        <th>Review</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <div className="crop-cell">
                              <span className={"crop-icon " + c.crop}>
                                <Sprout size={22} />
                              </span>
                              <div>
                                <strong>{label(c.crop)}</strong>
                                <small>{c.id.slice(0, 8)}</small>
                              </div>
                            </div>
                          </td>
                          <td>{c.owner_id}</td>
                          <td>{format(c.created_at)}</td>
                          <td>
                            <span className={"badge " + c.processing_state}>
                              {label(c.processing_state)}
                            </span>
                          </td>
                          <td>
                            <span className={"badge " + c.review_state}>
                              {label(c.review_state)}
                            </span>
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => act(() => openCase(c))}
                            >
                              Open
                              <ArrowRight size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <span>
                    <Sprout size={35} />
                  </span>
                  <h3>
                    {cases.length
                      ? "No matching cases"
                      : "Your next crop case starts here"}
                  </h3>
                  <p>
                    {admin
                      ? "Submit a crop check in the farmer app, then assign its review here."
                      : "When an administrator assigns a farmer’s case to you, it will appear in this queue."}
                  </p>
                </div>
              )}
              <div className="panel-footer">
                <ShieldCheck size={15} /> Private cases · permission-based
                access<span>Times shown for Namibia</span>
              </div>
            </section>
          )}
          {page === "Overview" && (
            <div className="bottom-grid">
              <section className="panel coverage">
                <div className="panel-heading">
                  <div>
                    <h2>Crop coverage</h2>
                    <p>Clear boundaries. Honest assessments.</p>
                  </div>
                  <Sprout size={22} />
                </div>
                {crops.map((c) => (
                  <div className="coverage-row" key={c.id}>
                    <span>{c.name}</span>
                    <span
                      className={
                        "badge " +
                        (c.inference_available ? "completed" : "requested")
                      }
                    >
                      {c.inference_available
                        ? c.mode === "fixture"
                          ? "Development fixture"
                          : "Configured model"
                        : "Advisor referral"}
                    </span>
                  </div>
                ))}
              </section>
              <section className="knowledge">
                <span className="eyebrow">CARE BEYOND THE CAMERA</span>
                <BookOpen size={28} />
                <h2>
                  A suggestion is
                  <br />
                  the start of a conversation.
                </h2>
                <p>
                  Photos show part of the picture. Consider symptoms, growing
                  conditions and follow-up before offering advice.
                </p>
                <button
                  className="text-button"
                  onClick={() => setPage("Guidance library")}
                >
                  Explore guidance
                  <ArrowRight size={16} />
                </button>
              </section>
            </div>
          )}
          {page === "Guidance library" && (
            <>
              <div className="section-actions">
                <span>{advice.length} content versions</span>
                {(admin || reviewer) && (
                  <button
                    className="primary"
                    onClick={() => setShowDraft(true)}
                  >
                    Create guidance draft
                  </button>
                )}
              </div>
              <div className="advice-grid">
                {advice.map((a) => (
                  <article className="panel advice-card" key={a.id}>
                    <div>
                      <span className="badge">{a.crop}</span>
                      <span className={"badge " + a.state}>
                        {a.state} · v{a.version}
                      </span>
                    </div>
                    <h2>{a.title}</h2>
                    {!!a.development_only && (
                      <div className="dev-label">
                        Development example · not field-approved
                      </div>
                    )}
                    <p>{a.body}</p>
                    <small>{a.condition}</small>
                    <ul>
                      {a.sources.map((s: string) => (
                        <li key={s}>
                          {s.startsWith("https://") ? (
                            <a href={s} target="_blank" rel="noreferrer">
                              {s}
                            </a>
                          ) : (
                            s
                          )}
                        </li>
                      ))}
                    </ul>
                    <footer>
                      {a.reviewed_at
                        ? `Reviewed by ${a.reviewer_id} · ${format(a.reviewed_at)}`
                        : "Awaiting reviewer approval"}
                    </footer>
                    {reviewer && a.state === "draft" && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            await api(`/admin/advice/${a.id}/publish`, "POST");
                            await load();
                          })
                        }
                      >
                        Publish reviewed version
                      </button>
                    )}
                  </article>
                ))}
              </div>
              {!advice.length && (
                <div className="empty">
                  <BookOpen />
                  <h3>No guidance available</h3>
                  <p>Reviewed guidance will appear here once published.</p>
                </div>
              )}
            </>
          )}
          {page === "People" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Workspace accounts</h2>
                <span className="count">{users.length}</span>
              </div>
              {users.map((u) => (
                <div className="person" key={u.id}>
                  <div className="avatar">{u.name[0]}</div>
                  <div>
                    <strong>{u.name}</strong>
                    <p>{u.id}</p>
                  </div>
                  <span className="badge">{u.roles.join(", ")}</span>
                </div>
              ))}
            </section>
          )}
          {page === "Activity log" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Traceable actions</h2>
                <ShieldCheck />
              </div>
              {audit.map((e) => (
                <div className="audit" key={e.id}>
                  <ShieldCheck size={18} />
                  <div>
                    <strong>{e.action}</strong>
                    <p>
                      {e.actor_id || "Analysis worker"} · {e.resource_id}
                    </p>
                    <small>
                      {format(e.created_at)} · {e.details}
                    </small>
                  </div>
                </div>
              ))}
              {!audit.length && (
                <div className="empty">No recorded actions yet.</div>
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>
              <Sprout size={15} />
              AgroSense AI
            </span>
            <span>Supporting decisions. Growing knowledge.</span>
          </footer>
        </div>
      </main>
      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <section className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <span className="eyebrow">
                  CROP CASE · {selected.id.slice(0, 8)}
                </span>
                <h2>{label(selected.crop)} assessment</h2>
              </div>
              <button
                className="icon"
                aria-label="Close case"
                onClick={() => setSelected(null)}
              >
                <X />
              </button>
            </div>
            <div className="drawer-content">
              <div className="tags">
                <span className="badge">
                  {label(selected.processing_state)}
                </span>
                <span className="badge">{label(selected.review_state)}</span>
              </div>
              <div className="photos">
                {photos.map((p) => (
                  <img key={p} src={p} alt="Farmer-submitted crop photograph" />
                ))}
              </div>
              <h3>Farmer observations</h3>
              <dl>
                {Object.entries(selected.symptoms).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{label(k)}</dt>
                    <dd>{String(v) || "Not provided"}</dd>
                  </React.Fragment>
                ))}
              </dl>
              <div className="result-box">
                <h3>AI suggestion</h3>
                {selected.analysis ? (
                  <>
                    <span className="badge">
                      {selected.analysis.mode} · {selected.analysis.status}
                    </span>
                    <p>{selected.analysis.reason}</p>
                    {selected.analysis.candidates.map((c: Row) => (
                      <strong key={c.condition}>{label(c.condition)}</strong>
                    ))}
                  </>
                ) : (
                  <p>
                    Analysis is {label(selected.processing_state)}. No
                    diagnostic result is available.
                  </p>
                )}
              </div>
              <h3>Guidance shown to farmer</h3>
              <p>
                {selected.advice?.body ||
                  "No matching reviewed guidance is available. Expert review is recommended."}
              </p>
              {selected.advice && (
                <small>
                  Version {selected.advice.version} ·{" "}
                  {selected.advice.development_only
                    ? "Development sample"
                    : `Reviewer: ${selected.advice.reviewer_id}`}
                </small>
              )}
              <h3>Advisor responses</h3>
              {selected.reviews.length ? (
                selected.reviews.map((r: Row) => (
                  <div className="review" key={r.id}>
                    <strong>Advisor reviewed · {format(r.created_at)}</strong>
                    <p>{r.response}</p>
                    {r.correction && (
                      <p>Correction and reason: {r.correction}</p>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted">No advisor response yet.</p>
              )}
              <h3>Follow-up observations</h3>
              {selected.followups.map((f: Row) => (
                <p key={f.id}>
                  <strong>{f.outcome}</strong> · {f.notes}
                </p>
              ))}
              {!selected.followups.length && (
                <p className="muted">No follow-up recorded.</p>
              )}
              {admin && (
                <div className="form-section">
                  <h3>Assign an advisor</h3>
                  <select
                    value={advisor}
                    onChange={(e) => setAdvisor(e.target.value)}
                  >
                    {users
                      .filter((u) => u.roles.includes("advisor"))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        setSelected(
                          await api(
                            `/admin/cases/${selected.id}/assignment`,
                            "POST",
                            { advisor_id: advisor },
                          ),
                        );
                        await load();
                      })
                    }
                  >
                    Assign review
                  </button>
                </div>
              )}
              {user.roles.includes("advisor") && (
                <form
                  className="form-section"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      setSelected(
                        await api(
                          `/advisor/cases/${selected.id}/response`,
                          "POST",
                          { response, correction: correction || undefined },
                        ),
                      );
                      setResponse("");
                      setCorrection("");
                      await load();
                    });
                  }}
                >
                  <h3>Share your assessment</h3>
                  <label>
                    Practical next steps
                    <textarea
                      required
                      minLength={5}
                      maxLength={4000}
                      value={response}
                      onChange={(e) => setResponse(e.target.value)}
                      placeholder="Explain what to check and when to follow up."
                    />
                  </label>
                  <label>
                    Correction and reason (optional)
                    <textarea
                      maxLength={1000}
                      value={correction}
                      onChange={(e) => setCorrection(e.target.value)}
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    Send advisor response
                    <ArrowRight size={17} />
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>
      )}
      {showDraft && (
        <div className="overlay">
          <section className="drawer">
            <div className="drawer-header">
              <h2>New guidance version</h2>
              <button
                className="icon"
                aria-label="Close draft"
                onClick={() => setShowDraft(false)}
              >
                <X />
              </button>
            </div>
            <form
              className="drawer-content form-section"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(async () => {
                  await api("/admin/advice", "POST", {
                    crop: f.get("crop"),
                    condition: f.get("condition"),
                    title: f.get("title"),
                    body: f.get("body"),
                    sources: [f.get("source")],
                    development_only: true,
                  });
                  setShowDraft(false);
                  await load();
                });
              }}
            >
              <div className="dev-label">
                Development draft. A reviewer must publish it.
              </div>
              <label>
                Crop
                <select name="crop">
                  <option>tomato</option>
                  <option>maize</option>
                  <option>mahangu</option>
                  <option>sorghum</option>
                </select>
              </label>
              <label>
                Condition identifier
                <input required name="condition" />
              </label>
              <label>
                Title
                <input required name="title" />
              </label>
              <label>
                Guidance
                <textarea required minLength={10} name="body" />
              </label>
              <label>
                Source URL
                <input required type="url" name="source" />
              </label>
              <button className="primary" disabled={busy}>
                Save draft
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
