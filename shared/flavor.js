// THE DERELICT — voice of the ship, and the only things a player may say.
// Canned lines keep the intercom free of free-text abuse and keep the
// table's information surface exactly as designed: no hidden signalling.

export const INTERCOM = [
  'THE DERELICT // VOYAGE 0041 // NO PORT OF CALL',
  'Doors sealed. The table is live.',
  'Six cards. Three stars. No witnesses.',
  'A star is a life. Spend it carefully.',
  'The dealer does not extend credit. The other one does.',
  'Private offers are sealed. What is said in the dark stays there.',
  'The ship does not stop for the eliminated.',
  'The last two will be invited to the back room.',
  'The back room has its own rules.',
  'The Crown has position. The Rebel has hunger.',
  'Bets are binding. So are debts.',
  'The pot is shielded. Your seat is not your name.',
  'The intercom is listening.',
  'Audit opens when the voyage ends.',
  'There is no shore on the schedule.',
];

export const TAUNTS = [
  'The water is patient.',
  'I can hear your cards from here.',
  'You should have taken the loan.',
  'There is no shore.',
  'Your star looks heavy.',
  'I counted your cards. You are short.',
  'The house always hears.',
  'Do not look at the door.',
  'I will keep a seat for you.',
  'You are already wet.',
  'Trade with me or drown.',
  'The intercom is broken. Nobody is coming.',
  'I have been where you are.',
  'Your hand is shaking.',
  'One star. That is all it takes.',
  'The tide does not negotiate.',
  'I do not need the cards to know.',
  'You are playing for the same door I am.',
];

export const ELIMINATION_LINES = [
  'The deck closes over the seat.',
  'The intercom calls a number that is no longer on board.',
  'One less chair. One more debt.',
  'The ship does not slow down.',
];

// Boundary text for the three moments the game wants to land.
export const ACT_LINES = {
  act1: 'ACT I — THE HOLD. Four seats. Three stars. One exit.',
  finale: 'ACT II — THE BACK ROOM. Two chairs. Five cards. No witnesses.',
  debt: 'The note comes due before the door opens.',
};
