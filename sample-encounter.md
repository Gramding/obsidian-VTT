---
map: "[[goblin-cave.jpg]]"
players:
  - "[[Thorin Ironforge]]"
  - "[[Aria Swiftwind]]"
  - "[[Milo Thistlewick]]"
---

# Goblin Cave Ambush

The party descends into the cave, torchlight flickering across wet stone. The smell of smoke and unwashed bodies grows stronger. Then — movement in the shadows.

```encounter
name: Goblin Cave Ambush
creatures:
  - 3: Goblin, 7, 15, 2
  - 1: Hobgoblin, 18, 16, 1
  - 2:
      creature: Goblin
      name: Goblin Shaman
      hp: 10
      ac: 12
```

## Notes

- The hobgoblin hangs back and directs the goblins
- Shaman will attempt to flee if reduced below 4 HP
- Reinforcements (2 more goblins) arrive on round 3 if the alarm is raised
