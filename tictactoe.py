import pygame
background_colour = (228,228,228)
black = (0,0,0)

screen = pygame.display.set_mode((750, 800))
map = [
    [0,0,0],
    [0,0,0],
    [0,0,0]
] # X = 1    O = 2
pygame.display.set_caption('TikTakToeTruck')
screen.fill(background_colour)
pygame.display.flip()
pygame.font.init() # you have to call this at the start, 
running = True
start= 0
turn= 2
activate= 1  
filled= 0
finished = False
someonewon = False
colour = (195,195,195)
my_font = pygame.font.SysFont('Times New Roman', 40)
while running:
    pygame.draw.line(screen,black, (0,250), (800,250))
    pygame.draw.line(screen,black, (0,500), (800,500))
    pygame.draw.line(screen,black, (250,0), (250,750))
    pygame.draw.line(screen,black, (500,0), (500,750))


    pygame.display.update() 

    for event in pygame.event.get():       

        if event.type == pygame.QUIT:
            running = False

        if finished == False:
            if event.type == pygame.MOUSEBUTTONDOWN:
                pos = pygame.mouse.get_pos()
                for i in range(0,3):
                    '''print('i:',i)'''
                    for j in range(0,3):
                        #print('j:',j)
                        if pos[0]>i*250 and pos[0]<i*250+250 and pos[1]>j*250 and pos[1]<j*250+250 and map[i][j] == 0:
                        
                            if turn % 2 == 0:
                                pygame.draw.line(screen,black, (i*250+25,j*250+25), (i*250+225,j*250+225))
                                pygame.draw.line(screen,black, (i*250+225,j*250+25), (i*250+25,j*250+225))
                                map[i][j] = 1
                                filled+= 1
                    
                            else:
                                pygame.draw.circle(screen,black,(i*250+125,j*250+125),95, 3)
                                map[i][j] = 2
                                filled+=1
                            turn += 1
                            print(map)
        for i in range(0,3):

            #Vertical
            if len(set(map[i])) == 1 and set(map[i]) != {0}:
                winner = "X" if map[i][0] == 1 else "O"
                text_surface = my_font.render('Player '+winner+' wins', False, (0, 0, 255))
                screen.blit(text_surface, (267,745))
                finished= True
                someonewon = True
            #Horizontal
            if map[0][i] == map[1][i] and map[0][i] == map[2][i] and map[0][i] != 0:
                winner = "X" if map[0][i] == 1 else "O"
                text_surface = my_font.render('Player '+winner+' wins', False, (0, 0, 255))   
                screen.blit(text_surface, (267,745))     
                finished= True
                someonewon = True
        # Diagonal
        diagonals = []
        diagonals.append([map[0][0],map[1][1],map[2][2]])
        diagonals.append([map[0][2],map[1][1],map[2][0]])
        #print(diagonals)
        if len(set(diagonals[0])) == 1 and diagonals[0][0] != 0:
            winner = "X" if diagonals[0][0] == 1 else "O"
            text_surface = my_font.render('Player '+winner+' wins', False, (0, 0, 255))   
            screen.blit(text_surface, (267,745))  
            finished= True
            someonewon = True
        if len(set(diagonals[1])) == 1 and diagonals[1][0] != 0:
            winner = "X" if diagonals[1][0] == 1 else "O"
            text_surface = my_font.render('Player '+winner+' wins', False, (0, 0, 255))   
            screen.blit(text_surface, (267,745))  
            finished= True
            someonewon = True
        #print tie
        if filled == 9 and someonewon == False:
            text_surface = my_font.render('tie', False, (0, 0, 255))   
            screen.blit(text_surface, (350,745))    
            finished= True 
        if finished == True:
            pygame.draw.rect(screen, colour, pygame.Rect(55, 750, 135, 755))
            pygame.draw.rect(screen, colour, pygame.Rect(555, 750, 135, 755))    
            text_surface = my_font.render('Close', False, (0, 0, 0))   
            screen.blit(text_surface, (75,751))
            text_surface = my_font.render('Restart', False, (0, 0, 0))   
            screen.blit(text_surface, (565,751)) 
            if event.type == pygame.MOUSEBUTTONDOWN:
                pos = pygame.mouse.get_pos()
                if pos[0] > 55 and pos[0] < 190 and pos[1] > 750:
                    running = False
                if pos[0] > 555 and pos[0] < 790 and pos[1] > 750:
                    map = [
                        [0,0,0],
                        [0,0,0],
                        [0,0,0]
                    ]
                    turn = 2
                    filled = 0
                    finished = False
                    someonewon = False
                    screen.fill(background_colour)

