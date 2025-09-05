#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal GameMaster implementation loading gamemaster data
const gmData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/gamemaster.min.json')));
const GameMaster = (function(){
  let instance;
  function create(){
    return {
      data: gmData,
      moveMap: new Map(gmData.moves.map(m => [m.moveId, m])),
      pokemonMap: new Map(gmData.pokemon.map(p => [p.speciesId, p])),
      getPokemonById(id){
        return JSON.parse(JSON.stringify(this.pokemonMap.get(id)));
      },
      getMoveById(id){
        return JSON.parse(JSON.stringify(this.moveMap.get(id)));
      },
      getCupById(id){
        return { name: id, include: [], exclude: [{ filterType: 'tag', values: ['mega'] }] };
      }
    };
  }
  return {
    getInstance(){
      if(!instance){ instance = create(); }
      return instance;
    }
  };
})();

global.GameMaster = GameMaster;

// Load battle engine scripts into this context
function load(file){
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}
const root = path.join(__dirname, '..', 'js');
load(path.join(root, 'battle', 'DamageCalculator.js'));
load(path.join(root, 'battle', 'timeline', 'TimelineEvent.js'));
load(path.join(root, 'battle', 'timeline', 'TimelineAction.js'));
load(path.join(root, 'battle', 'actions', 'ActionLogic.js'));
load(path.join(root, 'battle', 'Battle.js'));
load(path.join(root, 'pokemon', 'Pokemon.js'));

// Select first available moveset for a Pokemon
function selectDefaultMoves(p){
  p.selectMove('fast', p.fastMovePool[0].moveId);
  p.selectMove('charged', p.chargedMovePool[0].moveId, 0);
  if(p.chargedMovePool.length > 1){
    p.selectMove('charged', p.chargedMovePool[1].moveId, 1);
  } else {
    p.selectMove('charged', 'none', 1);
  }
}

// Run a single battle and return rating for the attacker
function simulate(attackerId, defenderId, shieldsA, shieldsB){
  const battle = new Battle();
  battle.setCP(1500);
  battle.setCup('all');

  const attacker = new Pokemon(attackerId, 0, battle);
  battle.setNewPokemon(attacker, 0, true);
  selectDefaultMoves(attacker);
  attacker.setShields(shieldsA);

  const defender = new Pokemon(defenderId, 1, battle);
  battle.setNewPokemon(defender, 1, true);
  selectDefaultMoves(defender);
  defender.setShields(shieldsB);

  battle.simulate();
  return battle.getBattleRatings()[0];
}

// Load ranking data and extract top species
const rankings = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/rankings/all/overall/rankings-1500.json')));
const metaArg = process.argv.find(a => a.startsWith('--meta='));
const metaCount = metaArg ? parseInt(metaArg.split('=')[1]) : 25;
const meta = rankings.slice(0, metaCount).map(p => p.speciesId);

const shieldScenarios = [ [0,0], [1,1], [2,2] ];

function* combinations(arr, k, start=0, prefix=[]){
  if(k === 0){
    yield prefix;
    return;
  }
  for(let i=start; i<=arr.length - k; i++){
    yield* combinations(arr, k-1, i+1, prefix.concat(arr[i]));
  }
}

function scoreTeam(team){
  let score = 0;
  for(const opponent of meta){
    if(team.includes(opponent)) continue;
    for(const member of team){
      for(const shields of shieldScenarios){
        const rating = simulate(member, opponent, shields[0], shields[1]);
        if(rating > 500){
          score++;
        }
      }
    }
  }
  return score;
}

const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;

const topTeams = [];
let count = 0;

for(const combo of combinations(meta, 3)){
  const s = scoreTeam(combo);
  topTeams.push({ team: combo, score: s });
  topTeams.sort((a, b) => b.score - a.score);
  if(topTeams.length > 5) topTeams.pop();
  count++;
  if(count >= limit) break;
}

console.log('Evaluated', count, 'team combinations');
topTeams.forEach((entry, i) => {
  console.log(`#${i+1}: ${entry.team.join(', ')} score ${entry.score}`);
});
