import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

plt.rcParams['font.family'] = 'DejaVu Sans'

axes = [
    'Контекстное\nокно',
    'Сила модели\n(интеллект)',
    'Скорость\nответа',
    'Веб-поиск',
    'Работа с\nфайлами',
    'Запуск кода\nна месте',
    'Память о\nчеловеке',
    'Приватность\nданных',
    'Мало лишних\nотказов',
    'Голосовой\nввод',
    'Мобильный\nUX (PWA)',
    'Бесплатность\nбез условий',
]

metiger = [4, 6, 7, 8, 7, 9, 8, 8, 8, 7, 7, 9]
deepseek = [10, 9, 8, 7, 9, 3, 6, 4, 5, 8, 8, 7]

N = len(axes)
angles = np.linspace(0, 2 * np.pi, N, endpoint=False).tolist()
metiger += metiger[:1]
deepseek += deepseek[:1]
angles += angles[:1]

fig, ax = plt.subplots(figsize=(9, 9), subplot_kw=dict(polar=True))
fig.patch.set_facecolor('#0b0c10')
ax.set_facecolor('#0b0c10')

ax.set_theta_offset(np.pi / 2)
ax.set_theta_direction(-1)

ax.set_xticks(angles[:-1])
ax.set_xticklabels(axes, color='#e8e8ea', fontsize=10.5)

ax.set_rlabel_position(0)
ax.set_yticks([2, 4, 6, 8, 10])
ax.set_yticklabels(['2', '4', '6', '8', '10'], color='#8a8f98', fontsize=8)
ax.set_ylim(0, 10)

ax.grid(color='#333640', linewidth=0.7)
ax.spines['polar'].set_color('#333640')

color_metiger = '#4b6ef5'
color_deepseek = '#e0516b'

ax.plot(angles, metiger, color=color_metiger, linewidth=2.4, label='MeTiger Ai')
ax.fill(angles, metiger, color=color_metiger, alpha=0.28)

ax.plot(angles, deepseek, color=color_deepseek, linewidth=2.4, label='DeepSeek')
ax.fill(angles, deepseek, color=color_deepseek, alpha=0.22)

for ang, m, d in zip(angles, metiger, deepseek):
    ax.plot(ang, m, 'o', color=color_metiger, markersize=4.5, zorder=5)
    ax.plot(ang, d, 'o', color=color_deepseek, markersize=4.5, zorder=5)

plt.legend(loc='upper right', bbox_to_anchor=(1.28, 1.12), facecolor='#1a1b20',
           edgecolor='#333640', labelcolor='#e8e8ea', fontsize=12)

plt.title('MeTiger Ai vs DeepSeek — 12 осей сравнения', color='#f2f2f4',
          fontsize=15, fontweight='bold', pad=36)

plt.tight_layout()
plt.savefig('/home/user/MeTiger-Ai/docs/compare/metiger-vs-deepseek-radar.png',
            dpi=200, facecolor=fig.get_facecolor())
print('OK')
