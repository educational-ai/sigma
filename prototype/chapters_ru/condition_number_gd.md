---
title: "Число обусловленности и градиентный спуск"
---

Рассмотрим задачу минимизации сильно выпуклой квадратичной функции, решаемую методом градиентного спуска:
$$
f(x) = \frac{1}{2} x^T A x - b^T x \qquad x^{k+1} = x^k - \alpha_k \nabla f(x^k).
$$

Метод градиентного спуска с шагом $\alpha_k = \frac{2}{\mu + L}$ сходится к оптимальному решению $x^*$ со следующей оценкой:
$$
\|x^{k+1} - x^*\|_2 = \left( \frac{\varkappa-1}{\varkappa+1}\right)^k \|x^0 - x^*\|_2 \qquad f(x^{k+1}) - f(x^*) = \left( \frac{\varkappa-1}{\varkappa+1}\right)^{2k} \left(f(x^0) - f(x^*)\right),
$$
где $\varkappa$ — число обусловленности матрицы Гессе $A$.


:::{.video}
condition_number_gd.mp4
:::


[Код](condition_number_gd.py)