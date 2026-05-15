"""Генерация графиков сходимости для параграфа про метод Ньютона."""
import numpy as np
import matplotlib.pyplot as plt
from matplotlib import rcParams

rcParams["font.family"] = "DejaVu Serif"
rcParams["font.size"] = 11
rcParams["axes.grid"] = True
rcParams["grid.alpha"] = 0.3
rcParams["mathtext.fontset"] = "cm"

OUT = "/home/claude/textbook/figures"


# ----------- 1. Геометрия метода Ньютона: касательные ---------------
def plot_tangent_geometry():
    f = lambda x: x ** 3 - 2 * x - 5
    df = lambda x: 3 * x ** 2 - 2
    x0 = 3.0
    iters = [x0]
    x = x0
    for _ in range(3):
        x = x - f(x) / df(x)
        iters.append(x)

    xs = np.linspace(1.4, 3.2, 400)
    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    ax.plot(xs, f(xs), "b-", lw=2, label=r"$y=f(x)$")
    ax.axhline(0, color="black", lw=0.8)

    colors = ["#d62728", "#2ca02c", "#9467bd"]
    for i in range(len(iters) - 1):
        xk = iters[i]
        yk = f(xk)
        slope = df(xk)
        # касательная линия y = yk + slope*(x - xk)
        x_tan = np.array([xk - 0.3, iters[i + 1] + 0.3])
        y_tan = yk + slope * (x_tan - xk)
        ax.plot(x_tan, y_tan, "--", color=colors[i], lw=1.4,
                label=fr"касательная в $x_{i}$")
        ax.plot([xk, xk], [0, yk], ":", color=colors[i], lw=1)
        ax.plot(xk, yk, "o", color=colors[i], ms=6)
        ax.plot(iters[i + 1], 0, "s", color=colors[i], ms=6)
        ax.annotate(fr"$x_{i}$", (xk, 0), textcoords="offset points",
                    xytext=(2, -14), fontsize=11, color=colors[i])

    # последняя точка
    ax.annotate(fr"$x_{len(iters)-1}$", (iters[-1], 0),
                textcoords="offset points", xytext=(2, -14),
                fontsize=11, color="black")
    ax.set_xlabel("$x$"); ax.set_ylabel("$y$")
    ax.set_title("Геометрия метода касательных: $f(x)=x^{3}-2x-5$")
    ax.legend(loc="upper left", fontsize=9)
    ax.set_xlim(1.4, 3.2)
    fig.tight_layout()
    fig.savefig(f"{OUT}/newton_geometry.pdf")
    plt.close(fig)


# ----------- 2. Сходимость метода Герона для sqrt(a) ----------------
def newton_sqrt(a, x0, n):
    xs = [x0]
    x = x0
    for _ in range(n):
        x = 0.5 * (x + a / x)
        xs.append(x)
    return np.array(xs)


def plot_sqrt_convergence():
    a = 2.0
    root = np.sqrt(a)
    starts = [0.1, 1.0, 5.0, 50.0]
    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    for x0 in starts:
        xs = newton_sqrt(a, x0, 10)
        err = np.abs(xs - root)
        err = np.where(err < 1e-16, 1e-16, err)
        ax.semilogy(range(len(err)), err, "o-",
                    label=fr"$x_0={x0}$")
    ax.set_xlabel("Номер итерации $k$")
    ax.set_ylabel(r"$|x_k - \sqrt{a}|$")
    ax.set_title(r"Глобальная сходимость метода Герона ($a=2$)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(f"{OUT}/sqrt_convergence.pdf")
    plt.close(fig)


# ----------- 3. Локальная сходимость для 1/a -----------------------
def newton_reciprocal(a, x0, n):
    xs = [x0]
    x = x0
    for _ in range(n):
        x = x * (2.0 - a * x)
        xs.append(x)
        if not np.isfinite(x) or abs(x) > 1e12:
            break
    return np.array(xs)


def plot_reciprocal_convergence():
    a = 3.0
    root = 1.0 / a
    # 2/a ≈ 0.6667 — граница интервала сходимости
    starts = [0.05, 0.2, 1.0 / 3.0 + 0.1, 0.66, 0.7]
    labels = ["$x_0=0.05$ (внутри)",
              "$x_0=0.2$ (внутри)",
              "$x_0=1/a+0.1$ (внутри)",
              "$x_0=0.66$ (на границе)",
              "$x_0=0.70$ (вне области)"]
    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    for x0, lab in zip(starts, labels):
        xs = newton_reciprocal(a, x0, 12)
        err = np.abs(xs - root)
        err = np.where(err < 1e-16, 1e-16, err)
        ax.semilogy(range(len(err)), err, "o-", label=lab)
    ax.axhline(1.0 / a, color="gray", ls=":", lw=1)
    ax.set_xlabel("Номер итерации $k$")
    ax.set_ylabel(r"$|x_k - 1/a|$")
    ax.set_title(r"Локальная сходимость метода Ньютона--Шульца ($a=3$)")
    ax.legend(fontsize=8, loc="lower right")
    ax.set_ylim(1e-17, 1e6)
    fig.tight_layout()
    fig.savefig(f"{OUT}/reciprocal_convergence.pdf")
    plt.close(fig)


# ----------- 4. Парабола Тейлора (для оптимизации) ------------------
def plot_taylor_parabola():
    f = lambda x: 0.25 * x ** 4 - x ** 2 + 0.5 * x + 2
    df = lambda x: x ** 3 - 2 * x + 0.5
    d2f = lambda x: 3 * x ** 2 - 2
    x0 = -1.6
    q = lambda x: f(x0) + df(x0) * (x - x0) + 0.5 * d2f(x0) * (x - x0) ** 2
    x_next = x0 - df(x0) / d2f(x0)

    xs = np.linspace(-2.2, 2.0, 400)
    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    ax.plot(xs, f(xs), "b-", lw=2, label="$f(x)$")
    ax.plot(xs, q(xs), "r--", lw=1.6, label=r"квадр. модель $q_k(x)$")
    ax.plot(x0, f(x0), "ko", ms=6); ax.annotate(r"$x_k$", (x0, f(x0)),
                                                xytext=(-8, 12),
                                                textcoords="offset points")
    ax.plot(x_next, q(x_next), "rs", ms=7)
    ax.annotate(r"$x_{k+1}=\arg\min q_k$", (x_next, q(x_next)),
                xytext=(8, 8), textcoords="offset points")
    ax.set_xlabel("$x$"); ax.set_ylabel("$y$")
    ax.set_title("Метод Ньютона как минимизация квадратичной модели")
    ax.legend(loc="upper center")
    ax.set_ylim(-1, 6)
    fig.tight_layout()
    fig.savefig(f"{OUT}/taylor_parabola.pdf")
    plt.close(fig)


if __name__ == "__main__":
    plot_tangent_geometry()
    plot_sqrt_convergence()
    plot_reciprocal_convergence()
    plot_taylor_parabola()
    print("Все рисунки готовы.")
