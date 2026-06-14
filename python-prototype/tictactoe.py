import pygame

# ---------------------------------------------------------------------------
# Tic Tac Toe (two players, same keyboard/mouse)
#
# The game now opens on a START MENU instead of jumping straight to the board.
# From the menu you can:
#   - Play vs Player .... the normal two-player game (unchanged)
#   - Play vs Computer .. opens a DIFFICULTY MENU (Easy / Medium / Impossible)
#   - How to Play ....... a short instructions screen with a Back button
#   - Quit .............. closes the game
#
# The two-player gameplay itself is exactly the same as before:
#   - X always goes first, players take turns clicking a cell
#   - the game detects a win (row / column / diagonal) or a tie
#   - when the game is over you can Close or Restart
#
# About "Play vs Computer":
#   For now this only lets you PICK a difficulty. There is no computer AI yet
#   (no random moves, no minimax). After picking a difficulty the normal board
#   opens and a small note shows which mode was chosen, e.g.
#   "Computer mode selected: Easy". We remember the choice in two variables
#   (game_mode and difficulty) so the AI is easy to add later.
#
# We keep track of which screen is showing with a single variable called
# `current_screen`. The main loop just looks at that variable to decide what
# to react to and what to draw.
# ---------------------------------------------------------------------------


# --- Colors (red, green, blue values from 0 to 255) ---
BACKGROUND_COLOR = (228, 228, 228)
LINE_COLOR = (0, 0, 0)          # black, used for the grid and the X / O marks
BUTTON_COLOR = (195, 195, 195)  # gray background for buttons
RESULT_TEXT_COLOR = (0, 0, 255) # blue, used for "Player X wins" / "tie"
BUTTON_TEXT_COLOR = (0, 0, 0)   # black text on the buttons

# --- Board / window measurements (in pixels) ---
CELL_SIZE = 250          # each of the 9 cells is 250 x 250
BOARD_SIZE = 750         # the playing area is 3 cells wide and tall (3 * 250)
WINDOW_WIDTH = 750
WINDOW_HEIGHT = 800      # a little taller than the board so there is room
                        # at the bottom for the result text and buttons

# --- Menu buttons (each is a rectangle: x, y, width, height) ---
# They are stacked in the middle of the window, one under the other.
PLAY_PLAYER_BUTTON = pygame.Rect(175, 320, 400, 70)
PLAY_COMPUTER_BUTTON = pygame.Rect(175, 410, 400, 70)
HOW_TO_PLAY_BUTTON = pygame.Rect(175, 500, 400, 70)
QUIT_BUTTON = pygame.Rect(175, 590, 400, 70)

# --- Difficulty buttons (shown after clicking "Play vs Computer") ---
# Same width as the menu buttons, stacked under the "Choose Difficulty" title.
EASY_BUTTON = pygame.Rect(175, 280, 400, 70)
MEDIUM_BUTTON = pygame.Rect(175, 370, 400, 70)
IMPOSSIBLE_BUTTON = pygame.Rect(175, 460, 400, 70)

# The Back button is reused on the "difficulty" and "how to play" screens.
BACK_BUTTON = pygame.Rect(275, 660, 200, 70)


def create_empty_board():
    """Return a fresh 3x3 board. Each cell is "" (empty), "X", or "O".

    A cell is reached with board[col][row]:
      - col is the column (left to right, matches the mouse x position)
      - row is the row    (top to bottom, matches the mouse y position)
    """
    return [
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
    ]


def get_clicked_cell(mouse_pos):
    """Turn a mouse (x, y) position into a (col, row) cell on the board.

    Returns None if the click was below the board (in the button strip).
    """
    x, y = mouse_pos
    if y >= BOARD_SIZE:          # clicked in the bottom button area, not the board
        return None
    col = x // CELL_SIZE
    row = y // CELL_SIZE
    return col, row


def draw_grid(screen):
    """Draw the four lines that make the 3x3 grid."""
    # Two horizontal lines
    pygame.draw.line(screen, LINE_COLOR, (0, 250), (800, 250))
    pygame.draw.line(screen, LINE_COLOR, (0, 500), (800, 500))
    # Two vertical lines
    pygame.draw.line(screen, LINE_COLOR, (250, 0), (250, 750))
    pygame.draw.line(screen, LINE_COLOR, (500, 0), (500, 750))


def draw_x(screen, col, row):
    """Draw an X (two crossing lines) inside the given cell."""
    left = col * CELL_SIZE
    top = row * CELL_SIZE
    pygame.draw.line(screen, LINE_COLOR, (left + 25, top + 25), (left + 225, top + 225))
    pygame.draw.line(screen, LINE_COLOR, (left + 225, top + 25), (left + 25, top + 225))


def draw_o(screen, col, row):
    """Draw an O (a circle) inside the given cell."""
    center_x = col * CELL_SIZE + 125
    center_y = row * CELL_SIZE + 125
    pygame.draw.circle(screen, LINE_COLOR, (center_x, center_y), 95, 3)


def draw_marks(screen, board):
    """Draw every X and O that is currently on the board."""
    for col in range(3):
        for row in range(3):
            if board[col][row] == "X":
                draw_x(screen, col, row)
            elif board[col][row] == "O":
                draw_o(screen, col, row)


def find_winner(board):
    """Return "X" or "O" if that player has three in a row, otherwise None."""
    # All eight possible winning lines, each written as three (col, row) cells.
    lines = [
        # Columns (top to bottom)
        [(0, 0), (0, 1), (0, 2)],
        [(1, 0), (1, 1), (1, 2)],
        [(2, 0), (2, 1), (2, 2)],
        # Rows (left to right)
        [(0, 0), (1, 0), (2, 0)],
        [(0, 1), (1, 1), (2, 1)],
        [(0, 2), (1, 2), (2, 2)],
        # Diagonals
        [(0, 0), (1, 1), (2, 2)],
        [(0, 2), (1, 1), (2, 0)],
    ]
    for line in lines:
        first_col, first_row = line[0]
        mark = board[first_col][first_row]
        if mark == "":
            continue  # an empty cell can't be part of a win
        # Win if all three cells in this line hold the same mark.
        if all(board[col][row] == mark for col, row in line):
            return mark
    return None


def is_board_full(board):
    """Return True when every cell has been filled (used to detect a tie)."""
    for col in range(3):
        for row in range(3):
            if board[col][row] == "":
                return False
    return True


def draw_result_text(screen, font, message, x):
    """Show the result message ("Player X wins" or "tie") at the bottom."""
    text_surface = font.render(message, False, RESULT_TEXT_COLOR)
    screen.blit(text_surface, (x, 745))


def draw_end_buttons(screen, font):
    """Draw the Close and Restart buttons in the strip below the board."""
    pygame.draw.rect(screen, BUTTON_COLOR, pygame.Rect(55, 750, 135, 755))
    pygame.draw.rect(screen, BUTTON_COLOR, pygame.Rect(555, 750, 135, 755))
    screen.blit(font.render("Close", False, BUTTON_TEXT_COLOR), (75, 751))
    screen.blit(font.render("Restart", False, BUTTON_TEXT_COLOR), (565, 751))


def clicked_close_button(mouse_pos):
    """Return True if the mouse clicked the Close button."""
    x, y = mouse_pos
    return 55 < x < 190 and y > 750


def clicked_restart_button(mouse_pos):
    """Return True if the mouse clicked the Restart button."""
    x, y = mouse_pos
    return 555 < x < 790 and y > 750


# ---------------------------------------------------------------------------
# Helpers for the menu and the other simple screens.
# ---------------------------------------------------------------------------

def draw_button(screen, font, button_rect, label):
    """Draw a gray button rectangle with its label centered inside it."""
    pygame.draw.rect(screen, BUTTON_COLOR, button_rect)
    text = font.render(label, False, BUTTON_TEXT_COLOR)
    # get_rect(center=...) lets us place the text in the middle of the button.
    screen.blit(text, text.get_rect(center=button_rect.center))


def draw_centered_text(screen, font, text, color, center_x, center_y):
    """Draw a line of text centered on the point (center_x, center_y)."""
    surface = font.render(text, False, color)
    screen.blit(surface, surface.get_rect(center=(center_x, center_y)))


def draw_menu(screen, title_font, font, small_font):
    """Draw the start menu: title, subtitle, and the four buttons."""
    center_x = WINDOW_WIDTH // 2
    draw_centered_text(screen, title_font, "Tic Tac Toe AI", LINE_COLOR, center_x, 130)
    draw_centered_text(
        screen, small_font,
        "Play against a friend or challenge the computer.",
        LINE_COLOR, center_x, 215,
    )
    draw_button(screen, font, PLAY_PLAYER_BUTTON, "Play vs Player")
    draw_button(screen, font, PLAY_COMPUTER_BUTTON, "Play vs Computer")
    draw_button(screen, font, HOW_TO_PLAY_BUTTON, "How to Play")
    draw_button(screen, font, QUIT_BUTTON, "Quit")


def draw_difficulty(screen, title_font, font):
    """Difficulty menu shown for 'Play vs Computer'.

    It only lets the player pick a difficulty for now. The buttons do not have
    any real computer AI behind them yet.
    """
    center_x = WINDOW_WIDTH // 2
    draw_centered_text(screen, title_font, "Choose Difficulty", LINE_COLOR, center_x, 150)
    draw_button(screen, font, EASY_BUTTON, "Easy")
    draw_button(screen, font, MEDIUM_BUTTON, "Medium")
    draw_button(screen, font, IMPOSSIBLE_BUTTON, "Impossible")
    draw_button(screen, font, BACK_BUTTON, "Back")


def draw_how_to_play(screen, title_font, font):
    """Simple instructions screen with a Back button."""
    center_x = WINDOW_WIDTH // 2
    draw_centered_text(screen, title_font, "How to Play", LINE_COLOR, center_x, 130)
    # The instructions are split over two lines so they fit on the screen.
    draw_centered_text(screen, font, "Take turns placing X and O.", LINE_COLOR, center_x, 290)
    draw_centered_text(screen, font, "Get three in a row to win.", LINE_COLOR, center_x, 350)
    draw_button(screen, font, BACK_BUTTON, "Back")


def main():
    pygame.init()
    pygame.font.init()
    screen = pygame.display.set_mode((WINDOW_WIDTH, WINDOW_HEIGHT))
    pygame.display.set_caption("Tic Tac Toe AI")

    # Three text sizes: a big one for titles, the normal one for buttons and
    # game text, and a small one for the subtitle.
    title_font = pygame.font.SysFont("Times New Roman", 64)
    font = pygame.font.SysFont("Times New Roman", 40)
    small_font = pygame.font.SysFont("Times New Roman", 26)

    # --- Which screen are we on? The whole game starts on the menu. ---
    current_screen = "menu"   # "menu", "game", "difficulty", or "how_to_play"

    # --- Game state: everything that describes the current game ---
    board = create_empty_board()  # the 3x3 grid of "", "X", "O"
    current_player = "X"          # X always moves first
    game_over = False             # True once someone wins or the board is full

    # --- How this game was started (used later when we add the computer AI) ---
    game_mode = "player"          # "player" (two humans) or "computer"
    difficulty = None             # None, or "Easy" / "Medium" / "Impossible"

    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            if event.type == pygame.MOUSEBUTTONDOWN:
                mouse_pos = pygame.mouse.get_pos()

                # --- The menu: each button leads to a different screen ---
                if current_screen == "menu":
                    if PLAY_PLAYER_BUTTON.collidepoint(mouse_pos):
                        # Start a fresh two-player game.
                        board = create_empty_board()
                        current_player = "X"
                        game_over = False
                        game_mode = "player"   # two humans, no computer
                        difficulty = None
                        current_screen = "game"
                    elif PLAY_COMPUTER_BUTTON.collidepoint(mouse_pos):
                        # Let the player pick a difficulty (no AI yet).
                        current_screen = "difficulty"
                    elif HOW_TO_PLAY_BUTTON.collidepoint(mouse_pos):
                        current_screen = "how_to_play"
                    elif QUIT_BUTTON.collidepoint(mouse_pos):
                        running = False

                # --- The actual tic tac toe game (unchanged behavior) ---
                elif current_screen == "game":
                    if not game_over:
                        # While the game is running, a click places a mark.
                        cell = get_clicked_cell(mouse_pos)
                        if cell is not None:
                            col, row = cell
                            if board[col][row] == "":          # only empty cells
                                board[col][row] = current_player
                                # Switch to the other player for the next turn.
                                current_player = "O" if current_player == "X" else "X"
                    else:
                        # When the game is over, the buttons are active.
                        if clicked_close_button(mouse_pos):
                            running = False
                        elif clicked_restart_button(mouse_pos):
                            board = create_empty_board()
                            current_player = "X"
                            game_over = False

                # --- Difficulty menu: pick a level, then start the board ---
                elif current_screen == "difficulty":
                    # A small helper so each difficulty button does the same
                    # thing: remember the choice and start a fresh game.
                    chosen = None
                    if EASY_BUTTON.collidepoint(mouse_pos):
                        chosen = "Easy"
                    elif MEDIUM_BUTTON.collidepoint(mouse_pos):
                        chosen = "Medium"
                    elif IMPOSSIBLE_BUTTON.collidepoint(mouse_pos):
                        chosen = "Impossible"

                    if chosen is not None:
                        # Remember the choice so the AI is easy to add later.
                        game_mode = "computer"
                        difficulty = chosen
                        board = create_empty_board()
                        current_player = "X"
                        game_over = False
                        current_screen = "game"
                    elif BACK_BUTTON.collidepoint(mouse_pos):
                        current_screen = "menu"

                # --- Simple screen: its Back button returns to the menu ---
                elif current_screen == "how_to_play":
                    if BACK_BUTTON.collidepoint(mouse_pos):
                        current_screen = "menu"

        # --- Draw everything for the current screen, every frame ---
        screen.fill(BACKGROUND_COLOR)

        if current_screen == "menu":
            draw_menu(screen, title_font, font, small_font)

        elif current_screen == "game":
            # Work out the result of the current board.
            winner = find_winner(board)
            if winner is not None or is_board_full(board):
                game_over = True

            draw_grid(screen)
            draw_marks(screen, board)

            # In computer mode, show a small note about which mode was picked.
            # (There is no AI yet, so this is just a reminder for now.)
            if game_mode == "computer" and not game_over:
                draw_centered_text(
                    screen, small_font,
                    "Computer mode selected: " + difficulty,
                    RESULT_TEXT_COLOR, WINDOW_WIDTH // 2, 775,
                )

            if game_over:
                if winner is not None:
                    draw_result_text(screen, font, "Player " + winner + " wins", 267)
                else:
                    draw_result_text(screen, font, "tie", 350)
                draw_end_buttons(screen, font)

        elif current_screen == "difficulty":
            draw_difficulty(screen, title_font, font)

        elif current_screen == "how_to_play":
            draw_how_to_play(screen, title_font, font)

        pygame.display.update()

    pygame.quit()


if __name__ == "__main__":
    main()
