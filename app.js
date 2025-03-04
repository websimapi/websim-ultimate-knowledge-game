// Initialize the multiplayer room
const room = new WebsimSocket();

// React component for the Ultimate Knowledge Game
function App() {
  const [activeTab, setActiveTab] = React.useState('play');
  const [gameState, setGameState] = React.useState('waiting');
  const [feedback, setFeedback] = React.useState('');
  const [creatorUsername, setCreatorUsername] = React.useState('');
  const [error, setError] = React.useState(null);
  
  // Get the creator of the project
  React.useEffect(() => {
    async function getCreator() {
      try {
        const creator = await window.websim.getCreatedBy();
        setCreatorUsername(creator.username);
      } catch (error) {
        console.error("Error getting creator:", error);
      }
    }
    getCreator();
  }, []);
  
  // Subscribe to peers to update the UI when players join/leave
  const peers = React.useSyncExternalStore(
    room.party.subscribe,
    () => room.party.peers
  );

  return (
    <div className="container">
      <h1>Ultimate Knowledge Game</h1>
      
      <div className="tabs">
        <div 
          className={`tab ${activeTab === 'play' ? 'active' : ''}`} 
          onClick={() => setActiveTab('play')}
        >
          Play Game
        </div>
        <div 
          className={`tab ${activeTab === 'create' ? 'active' : ''}`} 
          onClick={() => setActiveTab('create')}
        >
          Create Questions
        </div>
        <div 
          className={`tab ${activeTab === 'leaderboard' ? 'active' : ''}`} 
          onClick={() => setActiveTab('leaderboard')}
        >
          Leaderboard
        </div>
      </div>
      
      {error && <div className="error card">{error}</div>}
      {feedback && <div className="feedback">{feedback}</div>}
      
      <div className={activeTab === 'play' ? '' : 'hidden'}>
        <PlayerList peers={peers} currentClientId={room.party.client.id} />
        <GameBoard 
          room={room} 
          gameState={gameState} 
          setGameState={setGameState} 
          setFeedback={setFeedback}
          setError={setError}
          peers={peers}
        />
      </div>
      
      <div className={activeTab === 'create' ? '' : 'hidden'}>
        <QuestionCreator 
          room={room} 
          creatorUsername={creatorUsername} 
          setFeedback={setFeedback}
          setError={setError}
        />
      </div>
      
      <div className={activeTab === 'leaderboard' ? '' : 'hidden'}>
        <Leaderboard room={room} setError={setError} />
      </div>
    </div>
  );
}

// Component to display the list of connected players
function PlayerList({ peers, currentClientId }) {
  return (
    <div className="player-list card">
      <h3>Connected Players</h3>
      {Object.keys(peers).map(clientId => (
        <div key={clientId} className="player">
          <img 
            src={`https://images.websim.ai/avatar/${peers[clientId].username}`} 
            alt={peers[clientId].username} 
            className="player-avatar" 
          />
          <div>
            {peers[clientId].username} {clientId === currentClientId ? '(You)' : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

// Component for the main game board
function GameBoard({ room, gameState, setGameState, setFeedback, setError, peers }) {
  const [currentQuestion, setCurrentQuestion] = React.useState(null);
  const [selectedOption, setSelectedOption] = React.useState(null);
  const [correctOption, setCorrectOption] = React.useState(null);
  const [scores, setScores] = React.useState({});
  const [gameEnded, setGameEnded] = React.useState(false);
  const [timeLeft, setTimeLeft] = React.useState(0);
  const [timerInterval, setTimerInterval] = React.useState(null);
  
  // Subscribe to questions collection
  const questions = React.useSyncExternalStore(
    room.collection('question').subscribe,
    room.collection('question').getList
  );
  
  // Subscribe to game state collection
  const gameStates = React.useSyncExternalStore(
    room.collection('gameState').subscribe,
    room.collection('gameState').getList
  );
  
  // Subscribe to answers collection
  const answers = React.useSyncExternalStore(
    room.collection('answer').subscribe,
    room.collection('answer').getList
  );
  
  // Process game state changes
  React.useEffect(() => {
    if (gameStates.length > 0) {
      const latestState = gameStates[0];
      
      if (latestState.state === 'playing') {
        setGameState('playing');
        setCurrentQuestion(latestState.current_question);
        setSelectedOption(null);
        setCorrectOption(null);
        setGameEnded(false);
        
        // Start timer
        const endTime = new Date(latestState.end_time).getTime();
        clearInterval(timerInterval);
        
        const newInterval = setInterval(() => {
          const now = new Date().getTime();
          const timeRemaining = Math.max(0, Math.floor((endTime - now) / 1000));
          
          setTimeLeft(timeRemaining);
          
          if (timeRemaining <= 0) {
            clearInterval(newInterval);
          }
        }, 1000);
        
        setTimerInterval(newInterval);
      } else if (latestState.state === 'reveal') {
        setGameState('reveal');
        setCorrectOption(latestState.correct_option);
        
        // Update scores
        const newScores = {};
        answers.forEach(answer => {
          if (answer.question_id === latestState.current_question) {
            const isCorrect = answer.option === latestState.correct_option;
            const score = isCorrect ? (answer.time_left || 0) + 500 : 0;
            newScores[answer.username] = (newScores[answer.username] || 0) + score;
          }
        });
        
        setScores(prevScores => {
          const mergedScores = { ...prevScores };
          Object.keys(newScores).forEach(username => {
            mergedScores[username] = (mergedScores[username] || 0) + newScores[username];
          });
          return mergedScores;
        });
        
        clearInterval(timerInterval);
      } else if (latestState.state === 'ended') {
        setGameState('ended');
        setGameEnded(true);
        clearInterval(timerInterval);
        
        // Save final scores to leaderboard
        Object.keys(scores).forEach(async username => {
          try {
            // Check if player already has a leaderboard entry
            const existingEntries = room.collection('leaderboard')
              .filter({ username: username })
              .getList();
              
            if (existingEntries.length > 0) {
              // Update if new score is higher
              const entry = existingEntries[0];
              if (scores[username] > entry.score) {
                await room.collection('leaderboard').update(entry.id, {
                  score: scores[username],
                  timestamp: new Date().toISOString()
                });
              }
            } else {
              // Create new entry
              await room.collection('leaderboard').create({
                username: username,
                score: scores[username],
                timestamp: new Date().toISOString()
              });
            }
          } catch (error) {
            console.error("Error updating leaderboard:", error);
            setError("Failed to update leaderboard. Please try again.");
          }
        });
      } else {
        setGameState('waiting');
        setCurrentQuestion(null);
        clearInterval(timerInterval);
      }
    } else {
      setGameState('waiting');
    }
    
    return () => clearInterval(timerInterval);
  }, [gameStates, answers]);
  
  // Get the current question data
  const getCurrentQuestionData = () => {
    if (!currentQuestion) return null;
    return questions.find(q => q.id === currentQuestion) || null;
  };
  
  // Start a new game
  const startGame = async () => {
    try {
      // Check if there are enough questions
      if (questions.length < 5) {
        setError("Not enough questions. Create at least 5 questions before starting a game.");
        return;
      }
      
      // Clear previous game state
      const existingStates = gameStates;
      for (const state of existingStates) {
        await room.collection('gameState').delete(state.id);
      }
      
      // Get a random question
      const randomIndex = Math.floor(Math.random() * questions.length);
      const question = questions[randomIndex];
      
      // Create new game state
      const endTime = new Date();
      endTime.setSeconds(endTime.getSeconds() + 20); // 20 seconds per question
      
      await room.collection('gameState').create({
        state: 'playing',
        current_question: question.id,
        end_time: endTime.toISOString(),
        round: 1,
        total_rounds: 5
      });
      
      setFeedback("Game started!");
    } catch (error) {
      console.error("Error starting game:", error);
      setError("Failed to start game. Please try again.");
    }
  };
  
  // Submit an answer
  const submitAnswer = async (option) => {
    if (gameState !== 'playing' || !currentQuestion) return;
    
    try {
      setSelectedOption(option);
      
      // Submit answer
      await room.collection('answer').create({
        question_id: currentQuestion,
        option: option,
        time_left: timeLeft,
        username: room.party.client.username
      });
      
      setFeedback("Answer submitted!");
      
      // Check if all players have answered
      const questionAnswers = answers.filter(a => a.question_id === currentQuestion);
      const playerCount = Object.keys(peers).length;
      
      if (questionAnswers.length >= playerCount) {
        // Reveal the answer
        const questionData = getCurrentQuestionData();
        if (questionData) {
          await revealAnswer(questionData.correct_option);
        }
      }
    } catch (error) {
      console.error("Error submitting answer:", error);
      setError("Failed to submit answer. Please try again.");
    }
  };
  
  // Reveal the correct answer
  const revealAnswer = async (correctOption) => {
    try {
      // Update game state to reveal
      const gameState = gameStates[0];
      await room.collection('gameState').update(gameState.id, {
        state: 'reveal',
        correct_option: correctOption
      });
      
      // After 5 seconds, move to next question or end game
      setTimeout(async () => {
        const currentState = room.collection('gameState').getList()[0];
        if (!currentState) return;
        
        const currentRound = currentState.round || 1;
        const totalRounds = currentState.total_rounds || 5;
        
        if (currentRound >= totalRounds) {
          // End the game
          await room.collection('gameState').update(currentState.id, {
            state: 'ended'
          });
        } else {
          // Next question
          const usedQuestions = [];
          gameStates.forEach(state => {
            if (state.current_question) {
              usedQuestions.push(state.current_question);
            }
          });
          
          // Find unused questions
          const unusedQuestions = questions.filter(q => !usedQuestions.includes(q.id));
          
          if (unusedQuestions.length === 0) {
            await room.collection('gameState').update(currentState.id, {
              state: 'ended'
            });
            return;
          }
          
          // Choose a random unused question
          const randomIndex = Math.floor(Math.random() * unusedQuestions.length);
          const nextQuestion = unusedQuestions[randomIndex];
          
          // Start next round
          const endTime = new Date();
          endTime.setSeconds(endTime.getSeconds() + 20);
          
          await room.collection('gameState').update(currentState.id, {
            state: 'playing',
            current_question: nextQuestion.id,
            end_time: endTime.toISOString(),
            round: currentRound + 1,
            correct_option: null
          });
        }
      }, 5000);
    } catch (error) {
      console.error("Error revealing answer:", error);
      setError("Failed to reveal answer. Please try again.");
    }
  };
  
  // Render the question and options
  const questionData = getCurrentQuestionData();
  
  return (
    <div className="game-board">
      {gameState === 'waiting' && (
        <div className="card">
          <h2>Waiting to Start</h2>
          <p>Waiting for the game to begin. Click the button below to start a new game.</p>
          <button onClick={startGame}>Start Game</button>
        </div>
      )}
      
      {(gameState === 'playing' || gameState === 'reveal') && questionData && (
        <div className="card question-card">
          <div className="score-board">
            {Object.keys(scores).map(username => (
              <div key={username} className="score-card">
                <h3>{username}</h3>
                <p>{scores[username]} points</p>
              </div>
            ))}
          </div>
          
          <h3>Question {gameStates[0]?.round || 1} of {gameStates[0]?.total_rounds || 5}</h3>
          <p>{gameState === 'playing' ? `Time left: ${timeLeft} seconds` : 'Time\'s up!'}</p>
          
          <h2>{questionData.question}</h2>
          
          <div className="options">
            {['A', 'B', 'C', 'D'].map(option => (
              <div 
                key={option}
                className={`option ${selectedOption === option ? 'selected' : ''} ${gameState === 'reveal' && option === correctOption ? 'correct' : ''} ${gameState === 'reveal' && selectedOption === option && option !== correctOption ? 'incorrect' : ''}`}
                onClick={() => gameState === 'playing' && submitAnswer(option)}
              >
                <strong>{option}:</strong> {questionData[`option_${option.toLowerCase()}`]}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {gameState === 'ended' && (
        <div className="card">
          <h2>Game Over</h2>
          <h3>Final Scores</h3>
          <div className="score-board">
            {Object.keys(scores).map(username => (
              <div key={username} className="score-card">
                <h3>{username}</h3>
                <p>{scores[username]} points</p>
              </div>
            ))}
          </div>
          <button onClick={startGame}>Play Again</button>
        </div>
      )}
    </div>
  );
}

// Component for creating new questions
function QuestionCreator({ room, creatorUsername, setFeedback, setError }) {
  const [question, setQuestion] = React.useState('');
  const [optionA, setOptionA] = React.useState('');
  const [optionB, setOptionB] = React.useState('');
  const [optionC, setOptionC] = React.useState('');
  const [optionD, setOptionD] = React.useState('');
  const [correctOption, setCorrectOption] = React.useState('a');
  const [category, setCategory] = React.useState('general');
  
  // Submit a new question
  const submitQuestion = async (e) => {
    e.preventDefault();
    
    if (!question || !optionA || !optionB || !optionC || !optionD) {
      setError("Please fill in all fields");
      return;
    }
    
    try {
      await room.collection('question').create({
        question: question,
        option_a: optionA,
        option_b: optionB,
        option_c: optionC,
        option_d: optionD,
        correct_option: correctOption.toUpperCase(),
        category: category,
        created_by: creatorUsername
      });
      
      // Clear form
      setQuestion('');
      setOptionA('');
      setOptionB('');
      setOptionC('');
      setOptionD('');
      setCorrectOption('a');
      setCategory('general');
      
      setFeedback("Question created successfully!");
      setTimeout(() => setFeedback(''), 3000);
    } catch (error) {
      console.error("Error creating question:", error);
      setError("Failed to create question. Please try again.");
    }
  };
  
  return (
    <div className="create-question-form card">
      <h2>Create a New Question</h2>
      <form onSubmit={submitQuestion}>
        <div className="form-group">
          <label htmlFor="question">Question:</label>
          <input 
            type="text" 
            id="question" 
            value={question} 
            onChange={e => setQuestion(e.target.value)}
            placeholder="Enter your question"
            required
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="category">Category:</label>
          <select 
            id="category" 
            value={category} 
            onChange={e => setCategory(e.target.value)}
          >
            <option value="general">General Knowledge</option>
            <option value="science">Science</option>
            <option value="history">History</option>
            <option value="geography">Geography</option>
            <option value="entertainment">Entertainment</option>
            <option value="sports">Sports</option>
            <option value="technology">Technology</option>
          </select>
        </div>
        
        <div className="form-group">
          <label>Options:</label>
          
          <div className="option-input">
            <input 
              type="radio" 
              id="correct_a" 
              name="correct" 
              value="a" 
              checked={correctOption === 'a'} 
              onChange={() => setCorrectOption('a')}
            />
            <label htmlFor="correct_a">Correct</label>
            <input 
              type="text" 
              value={optionA} 
              onChange={e => setOptionA(e.target.value)}
              placeholder="Option A"
              required
            />
          </div>
          
          <div className="option-input">
            <input 
              type="radio" 
              id="correct_b" 
              name="correct" 
              value="b" 
              checked={correctOption === 'b'} 
              onChange={() => setCorrectOption('b')}
            />
            <label htmlFor="correct_b">Correct</label>
            <input 
              type="text" 
              value={optionB} 
              onChange={e => setOptionB(e.target.value)}
              placeholder="Option B"
              required
            />
          </div>
          
          <div className="option-input">
            <input 
              type="radio" 
              id="correct_c" 
              name="correct" 
              value="c" 
              checked={correctOption === 'c'} 
              onChange={() => setCorrectOption('c')}
            />
            <label htmlFor="correct_c">Correct</label>
            <input 
              type="text" 
              value={optionC} 
              onChange={e => setOptionC(e.target.value)}
              placeholder="Option C"
              required
            />
          </div>
          
          <div className="option-input">
            <input 
              type="radio" 
              id="correct_d" 
              name="correct" 
              value="d" 
              checked={correctOption === 'd'} 
              onChange={() => setCorrectOption('d')}
            />
            <label htmlFor="correct_d">Correct</label>
            <input 
              type="text" 
              value={optionD} 
              onChange={e => setOptionD(e.target.value)}
              placeholder="Option D"
              required
            />
          </div>
        </div>
        
        <button type="submit">Create Question</button>
      </form>
    </div>
  );
}

// Component for displaying leaderboard
function Leaderboard({ room, setError }) {
  // Subscribe to leaderboard collection
  const leaderboard = React.useSyncExternalStore(
    room.collection('leaderboard').subscribe,
    room.collection('leaderboard').getList
  );
  
  // Sort by score (highest first)
  const sortedLeaderboard = [...leaderboard].sort((a, b) => b.score - a.score);
  
  return (
    <div className="leaderboard-container card">
      <h2>Leaderboard</h2>
      
      {sortedLeaderboard.length === 0 ? (
        <p>No scores yet. Play a game to get on the leaderboard!</p>
      ) : (
        <table className="leaderboard">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Score</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {sortedLeaderboard.map((entry, index) => (
              <tr key={entry.id}>
                <td>{index + 1}</td>
                <td>
                  <div className="player">
                    <img 
                      src={`https://images.websim.ai/avatar/${entry.username}`} 
                      alt={entry.username} 
                      className="player-avatar" 
                      style={{width: '30px', height: '30px'}}
                    />
                    {entry.username}
                  </div>
                </td>
                <td>{entry.score}</td>
                <td>{new Date(entry.timestamp).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Render the app
ReactDOM.render(<App />, document.getElementById('app'));

