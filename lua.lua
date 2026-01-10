-- ui/menu.lua
-- Simple Hub - FULL FEATURE SET

return function(deps)
	local Tabs = deps.Tabs
	local Components = deps.Components
	local Animations = deps.Animations
	
	if not Tabs or not Components or not Animations then
		error("[Menu] Missing dependencies")
	end
	
	print("[SimpleHub] Initializing premium UI...")
	
	-- Services
	local Players = game:GetService("Players")
	local UIS = game:GetService("UserInputService")
	local TweenService = game:GetService("TweenService")
	local RunService = game:GetService("RunService")
	local Lighting = game:GetService("Lighting")
	local TeleportService = game:GetService("TeleportService")
	local StarterGui = game:GetService("StarterGui")
	local Debris = game:GetService("Debris")
	
	local player = Players.LocalPlayer
	local camera = workspace.CurrentCamera
	local mouse = player:GetMouse()
	
	-- Helpers
	local function getCharacter()
		return player.Character or player.CharacterAdded:Wait()
	end
	
	local function getRoot()
		local char = getCharacter()
		return char and char:FindFirstChild("HumanoidRootPart")
	end
	
	local function getHumanoid()
		local char = getCharacter()
		return char and char:FindFirstChildOfClass("Humanoid")
	end
	
	-- ============================================
	-- LOAD EXTERNAL MODULES
	-- ============================================
	local BASE = "https://raw.githubusercontent.com/queasy881/fly-script/main/Simple-Hub/"
	
	local function loadModule(path)
		local success, result = pcall(function()
			local src = game:HttpGet(BASE .. path .. "?nocache=" .. tostring(os.clock()))
			return loadstring(src)()
		end)
		if success then return result end
		warn("[SimpleHub] Failed to load " .. path)
		return nil
	end
	
	local Fly = loadModule("movement/fly.lua")
	local Noclip = loadModule("movement/noclip.lua")
	local Dash = loadModule("movement/dash.lua")
	local SilentAim = loadModule("combat/silent_aim.lua")
	
	-- ============================================
	-- ALL FEATURE STATES
	-- ============================================
	
	-- Movement
	local Movement = {
		walkSpeedEnabled = false,
		walkSpeedValue = 16,
		jumpPowerEnabled = false,
		jumpPowerValue = 50,
		infiniteJump = false,
		speedGlide = false,
		glideSpeed = 0.1,
		longJump = false,
		longJumpForce = 100,
		bunnyHop = false,
		anchored = false,
		clickTP = false
	}
	
	-- Combat
	local Combat = {
		aimAssistEnabled = false,
		aimAssistSmooth = 0.15,
		aimAssistFOV = 150,
		showFOVCircle = false,
		triggerbot = false,
		triggerbotDelay = 0.1,
		killAura = false,
		killAuraRange = 15,
		reach = false,
		reachDistance = 20,
		targetStrafe = false,
		strafeSpeed = 5,
		strafeRadius = 10
	}
	
	-- ESP
	local ESPState = {
		NameESP = false,
		BoxESP = false,
		HealthESP = false,
		DistanceESP = false,
		Tracers = false,
		Chams = false,
		SkeletonESP = false,
		ItemESP = false,
		NPCESP = false,
		OffscreenArrows = false
	}
	
	-- Visuals
	local Visuals = {
		fullbright = false,
		noFog = false,
		noShadows = false,
		customCrosshair = false,
		crosshairSize = 10,
		crosshairColor = Color3.fromRGB(255, 0, 0),
		cameraFOV = 70,
		freecam = false,
		freecamSpeed = 1,
		ambientColor = Color3.fromRGB(128, 128, 128),
		thirdPerson = false
	}
	
	-- Player
	local PlayerMods = {
		godMode = false,
		infiniteStamina = false,
		noRagdoll = false,
		noRecoil = false,
		noSpread = false
	}
	
	-- Misc
	local Misc = {
		antiAFK = false,
		chatSpam = false,
		chatSpamMsg = "Simple Hub on top!",
		chatSpamDelay = 2
	}
	
	-- World
	local World = {
		deleteMode = false,
		gravity = 196.2,
		timeOfDay = 14
	}
	
	-- ============================================
	-- DRAWING OBJECTS
	-- ============================================
	local ESPObjects = {}
	local DrawingObjects = {}
	
	-- FOV Circle
	pcall(function()
		DrawingObjects.FOVCircle = Drawing.new("Circle")
		DrawingObjects.FOVCircle.Thickness = 2
		DrawingObjects.FOVCircle.NumSides = 64
		DrawingObjects.FOVCircle.Filled = false
		DrawingObjects.FOVCircle.Visible = false
		DrawingObjects.FOVCircle.Color = Color3.fromRGB(255, 255, 255)
		DrawingObjects.FOVCircle.Transparency = 0.7
	end)
	
	-- Custom Crosshair
	pcall(function()
		DrawingObjects.CrosshairH = Drawing.new("Line")
		DrawingObjects.CrosshairH.Visible = false
		DrawingObjects.CrosshairH.Color = Color3.fromRGB(255, 0, 0)
		DrawingObjects.CrosshairH.Thickness = 2
		
		DrawingObjects.CrosshairV = Drawing.new("Line")
		DrawingObjects.CrosshairV.Visible = false
		DrawingObjects.CrosshairV.Color = Color3.fromRGB(255, 0, 0)
		DrawingObjects.CrosshairV.Thickness = 2
	end)
	
	-- ============================================
	-- STORED VALUES FOR RESTORATION
	-- ============================================
	local OriginalValues = {
		Ambient = Lighting.Ambient,
		Brightness = Lighting.Brightness,
		FogEnd = Lighting.FogEnd,
		FogStart = Lighting.FogStart,
		GlobalShadows = Lighting.GlobalShadows,
		OutdoorAmbient = Lighting.OutdoorAmbient,
		Gravity = workspace.Gravity,
		FieldOfView = camera.FieldOfView
	}
	
	-- ============================================
	-- HELPER FUNCTIONS
	-- ============================================
	
	local function getClosestPlayer(fov, teamCheck)
		local closest, closestDist = nil, math.huge
		local center = Vector2.new(camera.ViewportSize.X / 2, camera.ViewportSize.Y / 2)
		
		for _, plr in ipairs(Players:GetPlayers()) do
			if plr ~= player and plr.Character then
				local humanoid = plr.Character:FindFirstChildOfClass("Humanoid")
				local head = plr.Character:FindFirstChild("Head")
				
				if humanoid and humanoid.Health > 0 and head then
					local screenPos, onScreen = camera:WorldToViewportPoint(head.Position)
					
					if onScreen then
						local dist = (Vector2.new(screenPos.X, screenPos.Y) - center).Magnitude
						
						if dist < fov and dist < closestDist then
							closestDist = dist
							closest = {Player = plr, Character = plr.Character, Head = head, Humanoid = humanoid}
						end
					end
				end
			end
		end
		
		return closest
	end
	
	local function clearESP()
		for _, obj in pairs(ESPObjects) do
			pcall(function() if obj.Remove then obj:Remove() end end)
		end
		ESPObjects = {}
	end
	
	-- ============================================
	-- FREECAM VARIABLES
	-- ============================================
	local freecamPos = Vector3.new(0, 50, 0)
	local freecamCF = CFrame.new()
	
	-- ============================================
	-- MAIN UPDATE LOOP
	-- ============================================
	RunService.RenderStepped:Connect(function(dt)
		local char = player.Character
		camera = workspace.CurrentCamera
		
		local root = char and char:FindFirstChild("HumanoidRootPart")
		local humanoid = char and char:FindFirstChildOfClass("Humanoid")
		
		-- ========== MOVEMENT ==========
		
		-- Speed Glide
		if Movement.speedGlide and root and humanoid then
			if humanoid:GetState() == Enum.HumanoidStateType.Freefall then
				local vel = root.Velocity
				root.Velocity = Vector3.new(vel.X, math.max(vel.Y, -Movement.glideSpeed * 100), vel.Z)
			end
		end
		
		-- Bunny Hop
		if Movement.bunnyHop and humanoid then
			if humanoid.FloorMaterial ~= Enum.Material.Air then
				humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
			end
		end
		
		-- Anchor
		if Movement.anchored and root then
			root.Anchored = true
		elseif root and not Movement.anchored then
			-- Only unanchor if we anchored it
		end
		
		-- Fly update
		if Fly and Fly.enabled and Fly.update and root then
			Fly.update(root, camera, UIS)
		end
		
		-- Noclip update
		if Noclip and Noclip.enabled and Noclip.update and char then
			Noclip.update(char)
		end
		
		-- ========== COMBAT ==========
		
		-- Aim Assist
		if Combat.aimAssistEnabled and UIS:IsMouseButtonPressed(Enum.UserInputType.MouseButton2) then
			local target = getClosestPlayer(Combat.aimAssistFOV)
			if target and target.Head then
				local targetCF = CFrame.new(camera.CFrame.Position, target.Head.Position)
				camera.CFrame = camera.CFrame:Lerp(targetCF, Combat.aimAssistSmooth)
			end
		end
		
		-- Target Strafe
		if Combat.targetStrafe and UIS:IsMouseButtonPressed(Enum.UserInputType.MouseButton2) then
			local target = getClosestPlayer(Combat.aimAssistFOV)
			if target and target.Character and root then
				local targetRoot = target.Character:FindFirstChild("HumanoidRootPart")
				if targetRoot then
					local angle = tick() * Combat.strafeSpeed
					local offset = Vector3.new(math.cos(angle) * Combat.strafeRadius, 0, math.sin(angle) * Combat.strafeRadius)
					root.CFrame = CFrame.new(targetRoot.Position + offset, targetRoot.Position)
				end
			end
		end
		
		-- Triggerbot
		if Combat.triggerbot then
			local target = mouse.Target
			if target then
				local targetPlayer = Players:GetPlayerFromCharacter(target.Parent)
				if targetPlayer and targetPlayer ~= player then
					-- Simulate click
					mouse1click()
				end
			end
		end
		
		-- Kill Aura
		if Combat.killAura and root then
			for _, plr in ipairs(Players:GetPlayers()) do
				if plr ~= player and plr.Character then
					local targetRoot = plr.Character:FindFirstChild("HumanoidRootPart")
					local targetHum = plr.Character:FindFirstChildOfClass("Humanoid")
					if targetRoot and targetHum and targetHum.Health > 0 then
						local dist = (root.Position - targetRoot.Position).Magnitude
						if dist <= Combat.killAuraRange then
							-- Try to damage (works in some games)
							pcall(function()
								local tool = char:FindFirstChildOfClass("Tool")
								if tool then
									tool:Activate()
								end
							end)
						end
					end
				end
			end
		end
		
		-- ========== FOV CIRCLE ==========
		if DrawingObjects.FOVCircle then
			DrawingObjects.FOVCircle.Visible = Combat.showFOVCircle
			DrawingObjects.FOVCircle.Position = Vector2.new(camera.ViewportSize.X / 2, camera.ViewportSize.Y / 2)
			DrawingObjects.FOVCircle.Radius = Combat.aimAssistFOV
		end
		
		-- ========== CUSTOM CROSSHAIR ==========
		if DrawingObjects.CrosshairH and DrawingObjects.CrosshairV then
			local visible = Visuals.customCrosshair
			local cx, cy = camera.ViewportSize.X / 2, camera.ViewportSize.Y / 2
			local size = Visuals.crosshairSize
			
			DrawingObjects.CrosshairH.Visible = visible
			DrawingObjects.CrosshairH.From = Vector2.new(cx - size, cy)
			DrawingObjects.CrosshairH.To = Vector2.new(cx + size, cy)
			DrawingObjects.CrosshairH.Color = Visuals.crosshairColor
			
			DrawingObjects.CrosshairV.Visible = visible
			DrawingObjects.CrosshairV.From = Vector2.new(cx, cy - size)
			DrawingObjects.CrosshairV.To = Vector2.new(cx, cy + size)
			DrawingObjects.CrosshairV.Color = Visuals.crosshairColor
		end
		
		-- ========== FREECAM ==========
		if Visuals.freecam then
			local speed = Visuals.freecamSpeed * 2
			local move = Vector3.new()
			
			if UIS:IsKeyDown(Enum.KeyCode.W) then move = move + camera.CFrame.LookVector end
			if UIS:IsKeyDown(Enum.KeyCode.S) then move = move - camera.CFrame.LookVector end
			if UIS:IsKeyDown(Enum.KeyCode.A) then move = move - camera.CFrame.RightVector end
			if UIS:IsKeyDown(Enum.KeyCode.D) then move = move + camera.CFrame.RightVector end
			if UIS:IsKeyDown(Enum.KeyCode.Space) then move = move + Vector3.new(0, 1, 0) end
			if UIS:IsKeyDown(Enum.KeyCode.LeftShift) then move = move - Vector3.new(0, 1, 0) end
			
			if move.Magnitude > 0 then
				freecamPos = freecamPos + move.Unit * speed
			end
			
			camera.CameraType = Enum.CameraType.Scriptable
			camera.CFrame = CFrame.new(freecamPos) * CFrame.Angles(
				math.rad(freecamCF.X),
				math.rad(freecamCF.Y),
				0
			)
		end
		
		-- ========== PLAYER MODS ==========
		
		-- God Mode
		if PlayerMods.godMode and humanoid then
			humanoid.Health = humanoid.MaxHealth
		end
		
		-- No Ragdoll
		if PlayerMods.noRagdoll and humanoid then
			humanoid:SetStateEnabled(Enum.HumanoidStateType.Ragdoll, false)
			humanoid:SetStateEnabled(Enum.HumanoidStateType.FallingDown, false)
		end
		
		-- ========== MISC ==========
		
		-- Anti AFK
		if Misc.antiAFK then
			local vu = game:GetService("VirtualUser")
			pcall(function()
				vu:CaptureController()
				vu:ClickButton2(Vector2.new())
			end)
		end
		
		-- ========== ESP ==========
		updateESP()
	end)
	
	-- ============================================
	-- ESP UPDATE FUNCTION
	-- ============================================
	function updateESP()
		clearESP()
		
		local anyESPEnabled = ESPState.NameESP or ESPState.BoxESP or ESPState.HealthESP or 
			ESPState.DistanceESP or ESPState.Tracers or ESPState.SkeletonESP or ESPState.OffscreenArrows
		
		if not anyESPEnabled then return end
		
		for _, plr in ipairs(Players:GetPlayers()) do
			if plr ~= player and plr.Character then
				local char = plr.Character
				local humanoid = char:FindFirstChildOfClass("Humanoid")
				local rootPart = char:FindFirstChild("HumanoidRootPart")
				local head = char:FindFirstChild("Head")
				
				if humanoid and humanoid.Health > 0 and rootPart and head then
					local pos, onScreen = camera:WorldToViewportPoint(rootPart.Position)
					local distance = (camera.CFrame.Position - rootPart.Position).Magnitude
					local scaleFactor = math.clamp(1 / (pos.Z * 0.04), 0.2, 2)
					
					if onScreen then
						-- Name ESP
						if ESPState.NameESP then
							pcall(function()
								local tag = Drawing.new("Text")
								tag.Text = plr.Name
								tag.Size = 14
								tag.Color = Color3.fromRGB(255, 255, 255)
								tag.Center = true
								tag.Outline = true
								tag.Position = Vector2.new(pos.X, pos.Y - 50 * scaleFactor)
								tag.Visible = true
								table.insert(ESPObjects, tag)
							end)
						end
						
						-- Health ESP
						if ESPState.HealthESP then
							pcall(function()
								local tag = Drawing.new("Text")
								tag.Text = math.floor((humanoid.Health / humanoid.MaxHealth) * 100) .. "%"
								tag.Size = 12
								tag.Color = Color3.fromRGB(100, 255, 100)
								tag.Center = true
								tag.Outline = true
								tag.Position = Vector2.new(pos.X, pos.Y - 35 * scaleFactor)
								tag.Visible = true
								table.insert(ESPObjects, tag)
							end)
						end
						
						-- Distance ESP
						if ESPState.DistanceESP then
							pcall(function()
								local tag = Drawing.new("Text")
								tag.Text = math.floor(distance) .. "m"
								tag.Size = 12
								tag.Color = Color3.fromRGB(200, 200, 200)
								tag.Center = true
								tag.Outline = true
								tag.Position = Vector2.new(pos.X, pos.Y + 40 * scaleFactor)
								tag.Visible = true
								table.insert(ESPObjects, tag)
							end)
						end
						
						-- Box ESP
						if ESPState.BoxESP then
							pcall(function()
								local box = Drawing.new("Square")
								local boxSize = Vector2.new(50 * scaleFactor, 70 * scaleFactor)
								box.Size = boxSize
								box.Position = Vector2.new(pos.X - boxSize.X / 2, pos.Y - boxSize.Y / 2)
								box.Color = Color3.fromRGB(255, 0, 0)
								box.Thickness = 1
								box.Filled = false
								box.Visible = true
								table.insert(ESPObjects, box)
							end)
						end
						
						-- Tracers
						if ESPState.Tracers then
							pcall(function()
								local tracer = Drawing.new("Line")
								tracer.From = Vector2.new(camera.ViewportSize.X / 2, camera.ViewportSize.Y)
								tracer.To = Vector2.new(pos.X, pos.Y)
								tracer.Color = Color3.fromRGB(255, 255, 0)
								tracer.Thickness = 1
								tracer.Visible = true
								table.insert(ESPObjects, tracer)
							end)
						end
						
						-- Skeleton ESP
						if ESPState.SkeletonESP then
							pcall(function()
								local joints = {
									{"Head", "UpperTorso"},
									{"UpperTorso", "LowerTorso"},
									{"UpperTorso", "LeftUpperArm"},
									{"LeftUpperArm", "LeftLowerArm"},
									{"LeftLowerArm", "LeftHand"},
									{"UpperTorso", "RightUpperArm"},
									{"RightUpperArm", "RightLowerArm"},
									{"RightLowerArm", "RightHand"},
									{"LowerTorso", "LeftUpperLeg"},
									{"LeftUpperLeg", "LeftLowerLeg"},
									{"LeftLowerLeg", "LeftFoot"},
									{"LowerTorso", "RightUpperLeg"},
									{"RightUpperLeg", "RightLowerLeg"},
									{"RightLowerLeg", "RightFoot"}
								}
								
								-- R6 fallback
								local r6Joints = {
									{"Head", "Torso"},
									{"Torso", "Left Arm"},
									{"Torso", "Right Arm"},
									{"Torso", "Left Leg"},
									{"Torso", "Right Leg"}
								}
								
								local jointsToUse = char:FindFirstChild("UpperTorso") and joints or r6Joints
								
								for _, joint in ipairs(jointsToUse) do
									local part1 = char:FindFirstChild(joint[1])
									local part2 = char:FindFirstChild(joint[2])
									if part1 and part2 then
										local p1, onScreen1 = camera:WorldToViewportPoint(part1.Position)
										local p2, onScreen2 = camera:WorldToViewportPoint(part2.Position)
										if onScreen1 and onScreen2 then
											local line = Drawing.new("Line")
											line.From = Vector2.new(p1.X, p1.Y)
											line.To = Vector2.new(p2.X, p2.Y)
											line.Color = Color3.fromRGB(255, 255, 255)
											line.Thickness = 1
											line.Visible = true
											table.insert(ESPObjects, line)
										end
									end
								end
							end)
						end
					else
						-- Offscreen Arrows
						if ESPState.OffscreenArrows then
							pcall(function()
								local center = Vector2.new(camera.ViewportSize.X / 2, camera.ViewportSize.Y / 2)
								local screenPos = Vector2.new(pos.X, pos.Y)
								local dir = (screenPos - center).Unit
								local arrowPos = center + dir * 300
								
								-- Clamp to screen
								arrowPos = Vector2.new(
									math.clamp(arrowPos.X, 50, camera.ViewportSize.X - 50),
									math.clamp(arrowPos.Y, 50, camera.ViewportSize.Y - 50)
								)
								
								local arrow = Drawing.new("Triangle")
								local size = 15
								local angle = math.atan2(dir.Y, dir.X)
								
								arrow.PointA = arrowPos + Vector2.new(math.cos(angle) * size, math.sin(angle) * size)
								arrow.PointB = arrowPos + Vector2.new(math.cos(angle + 2.5) * size, math.sin(angle + 2.5) * size)
								arrow.PointC = arrowPos + Vector2.new(math.cos(angle - 2.5) * size, math.sin(angle - 2.5) * size)
								arrow.Color = Color3.fromRGB(255, 0, 0)
								arrow.Filled = true
								arrow.Visible = true
								table.insert(ESPObjects, arrow)
							end)
						end
					end
				end
			end
		end
		
		-- Item ESP
		if ESPState.ItemESP then
			for _, item in ipairs(workspace:GetDescendants()) do
				if item:IsA("Tool") or (item:IsA("BasePart") and item.Name:lower():find("item")) then
					local pos, onScreen = camera:WorldToViewportPoint(item.Position or item:GetPivot().Position)
					if onScreen then
						pcall(function()
							local tag = Drawing.new("Text")
							tag.Text = item.Name
							tag.Size = 12
							tag.Color = Color3.fromRGB(255, 200, 0)
							tag.Center = true
							tag.Outline = true
							tag.Position = Vector2.new(pos.X, pos.Y)
							tag.Visible = true
							table.insert(ESPObjects, tag)
						end)
					end
				end
			end
		end
		
		-- NPC ESP
		if ESPState.NPCESP then
			for _, npc in ipairs(workspace:GetDescendants()) do
				if npc:IsA("Model") and npc:FindFirstChildOfClass("Humanoid") and not Players:GetPlayerFromCharacter(npc) then
					local root = npc:FindFirstChild("HumanoidRootPart") or npc:FindFirstChild("Torso") or npc:FindFirstChild("Head")
					if root then
						local pos, onScreen = camera:WorldToViewportPoint(root.Position)
						if onScreen then
							pcall(function()
								local tag = Drawing.new("Text")
								tag.Text = "[NPC] " .. npc.Name
								tag.Size = 12
								tag.Color = Color3.fromRGB(0, 200, 255)
								tag.Center = true
								tag.Outline = true
								tag.Position = Vector2.new(pos.X, pos.Y - 30)
								tag.Visible = true
								table.insert(ESPObjects, tag)
							end)
						end
					end
				end
			end
		end
	end
	
	-- ============================================
	-- CHAMS UPDATE
	-- ============================================
	local function updateChams()
		for _, plr in ipairs(Players:GetPlayers()) do
			if plr ~= player and plr.Character then
				local existing = plr.Character:FindFirstChild("SimpleHubChams")
				if ESPState.Chams then
					if not existing then
						local h = Instance.new("Highlight")
						h.Name = "SimpleHubChams"
						h.FillColor = Color3.fromRGB(255, 0, 0)
						h.OutlineColor = Color3.fromRGB(255, 255, 255)
						h.FillTransparency = 0.5
						h.OutlineTransparency = 0
						h.Parent = plr.Character
					end
				else
					if existing then existing:Destroy() end
				end
			end
		end
	end
	
	-- ============================================
	-- INPUT HANDLING
	-- ============================================
	UIS.InputBegan:Connect(function(input, gameProcessed)
		if gameProcessed then return end
		
		-- Infinite Jump
		if input.KeyCode == Enum.KeyCode.Space then
			if Movement.infiniteJump then
				local humanoid = getHumanoid()
				if humanoid then
					humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
				end
			end
		end
		
		-- Long Jump
		if input.KeyCode == Enum.KeyCode.Space then
			if Movement.longJump then
				local root = getRoot()
				if root then
					local bv = Instance.new("BodyVelocity")
					bv.Velocity = camera.CFrame.LookVector * Movement.longJumpForce + Vector3.new(0, 50, 0)
					bv.MaxForce = Vector3.new(1e5, 1e5, 1e5)
					bv.Parent = root
					Debris:AddItem(bv, 0.2)
				end
			end
		end
		
		-- Dash
		if input.KeyCode == Enum.KeyCode.F then
			if Dash and Dash.enabled then
				local root = getRoot()
				if root then Dash.tryDash(root, camera) end
			end
		end
		
		-- Click TP
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			if Movement.clickTP then
				local root = getRoot()
				if root and mouse.Hit then
					root.CFrame = CFrame.new(mouse.Hit.Position + Vector3.new(0, 3, 0))
				end
			end
		end
		
		-- Delete Mode (World)
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			if World.deleteMode then
				local target = mouse.Target
				if target and not target:IsDescendantOf(player.Character or {}) then
					target:Destroy()
				end
			end
		end
	end)
	
	-- Freecam mouse movement
	UIS.InputChanged:Connect(function(input)
		if Visuals.freecam and input.UserInputType == Enum.UserInputType.MouseMovement then
			local delta = UIS:GetMouseDelta()
			freecamCF = Vector3.new(
				math.clamp(freecamCF.X - delta.Y * 0.5, -80, 80),
				freecamCF.Y - delta.X * 0.5,
				0
			)
		end
	end)
	
	-- ============================================
	-- CHAT SPAM LOOP
	-- ============================================
	task.spawn(function()
		while true do
			if Misc.chatSpam then
				pcall(function()
					game:GetService("ReplicatedStorage"):WaitForChild("DefaultChatSystemChatEvents"):WaitForChild("SayMessageRequest"):FireServer(Misc.chatSpamMsg, "All")
				end)
			end
			task.wait(Misc.chatSpamDelay)
		end
	end)
	
	-- ============================================
	-- COLORS
	-- ============================================
	local Colors = {
		Background = Color3.fromRGB(18, 18, 25),
		Panel = Color3.fromRGB(22, 22, 32),
		Surface = Color3.fromRGB(26, 26, 36),
		ContentBg = Color3.fromRGB(20, 20, 28),
		ScrollBg = Color3.fromRGB(18, 18, 25),
		Accent = Color3.fromRGB(60, 120, 255),
		Text = Color3.fromRGB(220, 220, 240),
		TextDim = Color3.fromRGB(140, 140, 160),
		Border = Color3.fromRGB(45, 50, 65)
	}
	
	-- ============================================
	-- CREATE GUI
	-- ============================================
	local gui = Instance.new("ScreenGui")
	gui.Name = "SimpleHub"
	gui.ResetOnSpawn = false
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = player:WaitForChild("PlayerGui")
	
	local main = Instance.new("Frame")
	main.Name = "Main"
	main.Size = UDim2.new(0, 900, 0, 600)
	main.Position = UDim2.new(0.5, 0, 0.5, 0)
	main.AnchorPoint = Vector2.new(0.5, 0.5)
	main.BackgroundColor3 = Colors.Background
	main.BorderSizePixel = 0
	main.ClipsDescendants = true
	main.Visible = false
	main.Parent = gui
	
	local mainCorner = Instance.new("UICorner")
	mainCorner.CornerRadius = UDim.new(0, 12)
	mainCorner.Parent = main
	
	local mainStroke = Instance.new("UIStroke")
	mainStroke.Color = Colors.Border
	mainStroke.Thickness = 2
	mainStroke.Transparency = 0.2
	mainStroke.Parent = main
	
	-- Header
	local header = Instance.new("Frame")
	header.Size = UDim2.new(1, 0, 0, 50)
	header.BackgroundColor3 = Colors.Panel
	header.BorderSizePixel = 0
	header.Parent = main
	
	local title = Instance.new("TextLabel")
	title.Size = UDim2.new(0, 300, 1, 0)
	title.Position = UDim2.new(0, 20, 0, 0)
	title.BackgroundTransparency = 1
	title.Text = "SIMPLE HUB"
	title.TextColor3 = Colors.Text
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.Font = Enum.Font.GothamBold
	title.TextSize = 18
	title.Parent = header
	
	local titleAccent = Instance.new("Frame")
	titleAccent.Size = UDim2.new(0, 50, 0, 3)
	titleAccent.Position = UDim2.new(0, 20, 1, -3)
	titleAccent.BackgroundColor3 = Colors.Accent
	titleAccent.BorderSizePixel = 0
	titleAccent.Parent = header
	Instance.new("UICorner", titleAccent).CornerRadius = UDim.new(1, 0)
	
	local closeBtn = Instance.new("TextButton")
	closeBtn.Size = UDim2.new(0, 32, 0, 32)
	closeBtn.Position = UDim2.new(1, -42, 0.5, 0)
	closeBtn.AnchorPoint = Vector2.new(0, 0.5)
	closeBtn.BackgroundColor3 = Color3.fromRGB(35, 35, 45)
	closeBtn.Text = "×"
	closeBtn.TextColor3 = Colors.Text
	closeBtn.Font = Enum.Font.GothamBold
	closeBtn.TextSize = 20
	closeBtn.AutoButtonColor = false
	closeBtn.Parent = header
	Instance.new("UICorner", closeBtn).CornerRadius = UDim.new(0, 6)
	
	closeBtn.MouseButton1Click:Connect(function() main.Visible = false end)
	closeBtn.MouseEnter:Connect(function()
		Animations.tween(closeBtn, {BackgroundColor3 = Color3.fromRGB(200, 50, 50)}, {Time = 0.15, Style = Enum.EasingStyle.Quad, Direction = Enum.EasingDirection.Out})
	end)
	closeBtn.MouseLeave:Connect(function()
		Animations.tween(closeBtn, {BackgroundColor3 = Color3.fromRGB(35, 35, 45)}, {Time = 0.15, Style = Enum.EasingStyle.Quad, Direction = Enum.EasingDirection.Out})
	end)
	
	-- Tab bar
	local tabBar = Instance.new("Frame")
	tabBar.Size = UDim2.new(1, 0, 0, 55)
	tabBar.Position = UDim2.new(0, 0, 0, 50)
	tabBar.BackgroundColor3 = Colors.Surface
	tabBar.BorderSizePixel = 0
	tabBar.Parent = main
	
	Tabs.setupTabBar(tabBar)
	
	-- Content area
	local contentArea = Instance.new("Frame")
	contentArea.Size = UDim2.new(1, 0, 1, -105)
	contentArea.Position = UDim2.new(0, 0, 0, 105)
	contentArea.BackgroundColor3 = Colors.ContentBg
	contentArea.BorderSizePixel = 0
	contentArea.Parent = main
	
	local contentContainer = Instance.new("Frame")
	contentContainer.Size = UDim2.new(1, -24, 1, -16)
	contentContainer.Position = UDim2.new(0, 12, 0, 8)
	contentContainer.BackgroundTransparency = 1
	contentContainer.Parent = contentArea
	
	local function createTabContent(name)
		local scroll = Instance.new("ScrollingFrame")
		scroll.Name = name
		scroll.Size = UDim2.new(1, 0, 1, 0)
		scroll.BackgroundColor3 = Colors.ScrollBg
		scroll.BackgroundTransparency = 0
		scroll.BorderSizePixel = 0
		scroll.ScrollBarThickness = 4
		scroll.ScrollBarImageColor3 = Colors.Accent
		scroll.CanvasSize = UDim2.new(0, 0, 0, 0)
		scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
		scroll.Visible = false
		scroll.Parent = contentContainer
		
		local layout = Instance.new("UIListLayout")
		layout.Padding = UDim.new(0, 8)
		layout.SortOrder = Enum.SortOrder.LayoutOrder
		layout.Parent = scroll
		
		local padding = Instance.new("UIPadding")
		padding.PaddingTop = UDim.new(0, 4)
		padding.PaddingBottom = UDim.new(0, 8)
		padding.PaddingLeft = UDim.new(0, 4)
		padding.PaddingRight = UDim.new(0, 8)
		padding.Parent = scroll
		
		return scroll
	end
	
	-- Create all tab contents
	local movementContent = createTabContent("Movement")
	local combatContent = createTabContent("Combat")
	local espContent = createTabContent("ESP")
	local visualsContent = createTabContent("Visuals")
	local playerContent = createTabContent("Player")
	local miscContent = createTabContent("Misc")
	local worldContent = createTabContent("World")
	
	-- Create tabs
	local movementTab = Tabs.create(tabBar, "Movement", "🏃")
	local combatTab = Tabs.create(tabBar, "Combat", "🎯")
	local espTab = Tabs.create(tabBar, "ESP", "👁")
	local visualsTab = Tabs.create(tabBar, "Visuals", "🎨")
	local playerTab = Tabs.create(tabBar, "Player", "👤")
	local miscTab = Tabs.create(tabBar, "Misc", "⚙")
	local worldTab = Tabs.create(tabBar, "World", "🌍")
	
	Tabs.connectTab(movementTab, movementContent)
	Tabs.connectTab(combatTab, combatContent)
	Tabs.connectTab(espTab, espContent)
	Tabs.connectTab(visualsTab, visualsContent)
	Tabs.connectTab(playerTab, playerContent)
	Tabs.connectTab(miscTab, miscContent)
	Tabs.connectTab(worldTab, worldContent)
	
	-- ============================================
	-- MOVEMENT TAB
	-- ============================================
	Components.createSection(movementContent, "Flight & Noclip")
	
	Components.createToggle(movementContent, "Fly", function(state)
		if Fly then
			if state then
				local root = getRoot()
				if root then Fly.enable(root, camera) end
			else
				Fly.disable()
			end
		end
	end)
	
	Components.createSlider(movementContent, "Fly Speed", 10, 200, 50, function(value)
		if Fly then Fly.speed = value end
	end)
	
	Components.createToggle(movementContent, "Noclip", function(state)
		if Noclip then Noclip.enabled = state end
	end)
	
	Components.createDivider(movementContent)
	Components.createSection(movementContent, "Speed & Jump")
	
	Components.createToggle(movementContent, "Walk Speed", function(state)
		Movement.walkSpeedEnabled = state
		local hum = getHumanoid()
		if hum then hum.WalkSpeed = state and Movement.walkSpeedValue or 16 end
	end)
	
	Components.createSlider(movementContent, "Speed Value", 16, 300, 16, function(value)
		Movement.walkSpeedValue = value
		if Movement.walkSpeedEnabled then
			local hum = getHumanoid()
			if hum then hum.WalkSpeed = value end
		end
	end)
	
	Components.createToggle(movementContent, "Jump Power", function(state)
		Movement.jumpPowerEnabled = state
		local hum = getHumanoid()
		if hum then hum.JumpPower = state and Movement.jumpPowerValue or 50 end
	end)
	
	Components.createSlider(movementContent, "Jump Value", 50, 400, 50, function(value)
		Movement.jumpPowerValue = value
		if Movement.jumpPowerEnabled then
			local hum = getHumanoid()
			if hum then hum.JumpPower = value end
		end
	end)
	
	Components.createToggle(movementContent, "Infinite Jump", function(state)
		Movement.infiniteJump = state
	end)
	
	Components.createDivider(movementContent)
	Components.createSection(movementContent, "Special Movement")
	
	Components.createToggle(movementContent, "Speed Glide", function(state)
		Movement.speedGlide = state
	end)
	
	Components.createSlider(movementContent, "Glide Speed", 1, 50, 10, function(value)
		Movement.glideSpeed = value / 100
	end)
	
	Components.createToggle(movementContent, "Long Jump", function(state)
		Movement.longJump = state
	end)
	
	Components.createSlider(movementContent, "Long Jump Force", 50, 300, 100, function(value)
		Movement.longJumpForce = value
	end)
	
	Components.createToggle(movementContent, "Bunny Hop", function(state)
		Movement.bunnyHop = state
	end)
	
	Components.createToggle(movementContent, "Dash (Press F)", function(state)
		if Dash then Dash.enabled = state end
	end)
	
	Components.createDivider(movementContent)
	Components.createSection(movementContent, "Teleport")
	
	Components.createToggle(movementContent, "Click TP", function(state)
		Movement.clickTP = state
	end)
	
	Components.createToggle(movementContent, "Anchor", function(state)
		Movement.anchored = state
		local root = getRoot()
		if root then root.Anchored = state end
	end)
	
	-- ============================================
	-- COMBAT TAB
	-- ============================================
	Components.createSection(combatContent, "Aim Assist")
	
	Components.createToggle(combatContent, "Aim Assist", function(state)
		Combat.aimAssistEnabled = state
	end)
	
	Components.createSlider(combatContent, "Smoothness", 1, 100, 15, function(value)
		Combat.aimAssistSmooth = value / 200
	end)
	
	Components.createSlider(combatContent, "FOV", 50, 500, 150, function(value)
		Combat.aimAssistFOV = value
		if SilentAim then SilentAim.fov = value end
	end)
	
	Components.createToggle(combatContent, "Show FOV Circle", function(state)
		Combat.showFOVCircle = state
	end)
	
	Components.createDivider(combatContent)
	Components.createSection(combatContent, "Silent Aim")
	
	Components.createToggle(combatContent, "Silent Aim", function(state)
		if SilentAim then SilentAim.enabled = state end
	end)
	
	Components.createSlider(combatContent, "Hit Chance", 0, 100, 100, function(value)
		if SilentAim then SilentAim.hitChance = value end
	end)
	
	Components.createDivider(combatContent)
	Components.createSection(combatContent, "Auto")
	
	Components.createToggle(combatContent, "Triggerbot", function(state)
		Combat.triggerbot = state
	end)
	
	Components.createToggle(combatContent, "Kill Aura", function(state)
		Combat.killAura = state
	end)
	
	Components.createSlider(combatContent, "Kill Aura Range", 5, 30, 15, function(value)
		Combat.killAuraRange = value
	end)
	
	Components.createDivider(combatContent)
	Components.createSection(combatContent, "Movement")
	
	Components.createToggle(combatContent, "Target Strafe", function(state)
		Combat.targetStrafe = state
	end)
	
	Components.createSlider(combatContent, "Strafe Speed", 1, 20, 5, function(value)
		Combat.strafeSpeed = value
	end)
	
	Components.createSlider(combatContent, "Strafe Radius", 5, 25, 10, function(value)
		Combat.strafeRadius = value
	end)
	
	-- ============================================
	-- ESP TAB
	-- ============================================
	Components.createSection(espContent, "Player ESP")
	
	Components.createToggle(espContent, "Name ESP", function(state)
		ESPState.NameESP = state
	end)
	
	Components.createToggle(espContent, "Box ESP", function(state)
		ESPState.BoxESP = state
	end)
	
	Components.createToggle(espContent, "Health ESP", function(state)
		ESPState.HealthESP = state
	end)
	
	Components.createToggle(espContent, "Distance ESP", function(state)
		ESPState.DistanceESP = state
	end)
	
	Components.createToggle(espContent, "Tracers", function(state)
		ESPState.Tracers = state
	end)
	
	Components.createToggle(espContent, "Skeleton ESP", function(state)
		ESPState.SkeletonESP = state
	end)
	
	Components.createToggle(espContent, "Offscreen Arrows", function(state)
		ESPState.OffscreenArrows = state
	end)
	
	Components.createDivider(espContent)
	Components.createSection(espContent, "World ESP")
	
	Components.createToggle(espContent, "Item ESP", function(state)
		ESPState.ItemESP = state
	end)
	
	Components.createToggle(espContent, "NPC ESP", function(state)
		ESPState.NPCESP = state
	end)
	
	Components.createDivider(espContent)
	Components.createSection(espContent, "Highlights")
	
	Components.createToggle(espContent, "Chams", function(state)
		ESPState.Chams = state
		updateChams()
	end)
	
	-- ============================================
	-- VISUALS TAB
	-- ============================================
	Components.createSection(visualsContent, "Lighting")
	
	Components.createToggle(visualsContent, "Fullbright", function(state)
		Visuals.fullbright = state
		if state then
			Lighting.Ambient = Color3.new(1, 1, 1)
			Lighting.Brightness = 2
			Lighting.OutdoorAmbient = Color3.new(1, 1, 1)
		else
			Lighting.Ambient = OriginalValues.Ambient
			Lighting.Brightness = OriginalValues.Brightness
			Lighting.OutdoorAmbient = OriginalValues.OutdoorAmbient
		end
	end)
	
	Components.createToggle(visualsContent, "No Fog", function(state)
		Visuals.noFog = state
		if state then
			Lighting.FogEnd = 1e10
			Lighting.FogStart = 1e10
		else
			Lighting.FogEnd = OriginalValues.FogEnd
			Lighting.FogStart = OriginalValues.FogStart
		end
	end)
	
	Components.createToggle(visualsContent, "No Shadows", function(state)
		Visuals.noShadows = state
		Lighting.GlobalShadows = not state
	end)
	
	Components.createDivider(visualsContent)
	Components.createSection(visualsContent, "Crosshair")
	
	Components.createToggle(visualsContent, "Custom Crosshair", function(state)
		Visuals.customCrosshair = state
	end)
	
	Components.createSlider(visualsContent, "Crosshair Size", 5, 50, 10, function(value)
		Visuals.crosshairSize = value
	end)
	
	Components.createDivider(visualsContent)
	Components.createSection(visualsContent, "Camera")
	
	Components.createSlider(visualsContent, "Camera FOV", 30, 120, 70, function(value)
		Visuals.cameraFOV = value
		camera.FieldOfView = value
	end)
	
	Components.createToggle(visualsContent, "Third Person", function(state)
		Visuals.thirdPerson = state
		if state then
			player.CameraMaxZoomDistance = 100
			player.CameraMinZoomDistance = 15
		else
			player.CameraMaxZoomDistance = 128
			player.CameraMinZoomDistance = 0.5
		end
	end)
	
	Components.createToggle(visualsContent, "Freecam", function(state)
		Visuals.freecam = state
		if state then
			freecamPos = camera.CFrame.Position
			UIS.MouseBehavior = Enum.MouseBehavior.LockCenter
		else
			camera.CameraType = Enum.CameraType.Custom
			UIS.MouseBehavior = Enum.MouseBehavior.Default
		end
	end)
	
	Components.createSlider(visualsContent, "Freecam Speed", 1, 10, 1, function(value)
		Visuals.freecamSpeed = value
	end)
	
	-- ============================================
	-- PLAYER TAB
	-- ============================================
	Components.createSection(playerContent, "Character")
	
	Components.createToggle(playerContent, "God Mode", function(state)
		PlayerMods.godMode = state
	end)
	
	Components.createToggle(playerContent, "No Ragdoll", function(state)
		PlayerMods.noRagdoll = state
	end)
	
	Components.createToggle(playerContent, "Invisibility", function(state)
		local char = getCharacter()
		if char then
			for _, part in ipairs(char:GetDescendants()) do
				if part:IsA("BasePart") and part.Name ~= "HumanoidRootPart" then
					part.Transparency = state and 1 or 0
				elseif part:IsA("Decal") then
					part.Transparency = state and 1 or 0
				end
			end
		end
	end)
	
	Components.createDivider(playerContent)
	Components.createSection(playerContent, "Weapon (Game Specific)")
	
	Components.createToggle(playerContent, "No Recoil", function(state)
		PlayerMods.noRecoil = state
	end)
	
	Components.createToggle(playerContent, "No Spread", function(state)
		PlayerMods.noSpread = state
	end)
	
	Components.createToggle(playerContent, "Infinite Stamina", function(state)
		PlayerMods.infiniteStamina = state
	end)
	
	-- ============================================
	-- MISC TAB
	-- ============================================
	Components.createSection(miscContent, "Anti-Detection")
	
	Components.createToggle(miscContent, "Anti AFK", function(state)
		Misc.antiAFK = state
	end)
	
	Components.createDivider(miscContent)
	Components.createSection(miscContent, "Chat")
	
	Components.createToggle(miscContent, "Chat Spam", function(state)
		Misc.chatSpam = state
	end)
	
	Components.createSlider(miscContent, "Spam Delay", 1, 10, 2, function(value)
		Misc.chatSpamDelay = value
	end)
	
	Components.createDivider(miscContent)
	Components.createSection(miscContent, "Server")
	
	Components.createToggle(miscContent, "Server Hop", function(state)
		if state then
			pcall(function()
				local servers = game.HttpService:JSONDecode(game:HttpGet("https://games.roblox.com/v1/games/" .. game.PlaceId .. "/servers/Public?sortOrder=Asc&limit=100"))
				for _, server in ipairs(servers.data) do
					if server.id ~= game.JobId then
						TeleportService:TeleportToPlaceInstance(game.PlaceId, server.id)
						break
					end
				end
			end)
		end
	end)
	
	Components.createToggle(miscContent, "Rejoin", function(state)
		if state then
			TeleportService:Teleport(game.PlaceId)
		end
	end)
	
	-- ============================================
	-- WORLD TAB
	-- ============================================
	Components.createSection(worldContent, "Environment")
	
	Components.createSlider(worldContent, "Time of Day", 0, 24, 14, function(value)
		World.timeOfDay = value
		Lighting.ClockTime = value
	end)
	
	Components.createSlider(worldContent, "Gravity", 0, 500, 196, function(value)
		World.gravity = value
		workspace.Gravity = value
	end)
	
	Components.createDivider(worldContent)
	Components.createSection(worldContent, "Terrain")
	
	Components.createToggle(worldContent, "Remove Grass", function(state)
		local terrain = workspace:FindFirstChildOfClass("Terrain")
		if terrain then terrain.Decoration = not state end
		for _, obj in ipairs(workspace:GetDescendants()) do
			if obj:IsA("BasePart") then
				local name = obj.Name:lower()
				if name:find("grass") or name:find("foliage") or name:find("bush") then
					obj.Transparency = state and 1 or 0
				end
			end
		end
	end)
	
	Components.createDivider(worldContent)
	Components.createSection(worldContent, "Tools")
	
	Components.createToggle(worldContent, "Delete Mode (Click)", function(state)
		World.deleteMode = state
	end)
	
	-- Activate first tab
	Tabs.activate(movementTab, movementContent)
	
	-- ============================================
	-- TOGGLE MENU KEYBIND
	-- ============================================
	UIS.InputBegan:Connect(function(input, gameProcessed)
		if gameProcessed then return end
		if input.KeyCode == Enum.KeyCode.M then
			main.Visible = not main.Visible
			if main.Visible then
				main.Size = UDim2.new(0, 0, 0, 0)
				Animations.tween(main, {Size = UDim2.new(0, 900, 0, 600)}, {Time = 0.4, Style = Enum.EasingStyle.Back, Direction = Enum.EasingDirection.Out})
			end
		end
	end)
	
	-- ============================================
	-- DRAGGING
	-- ============================================
	local dragging, dragStart, startPos = false, nil, nil
	
	header.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			dragging = true
			dragStart = input.Position
			startPos = main.Position
			input.Changed:Connect(function()
				if input.UserInputState == Enum.UserInputState.End then dragging = false end
			end)
		end
	end)
	
	UIS.InputChanged:Connect(function(input)
		if dragging and input.UserInputType == Enum.UserInputType.MouseMovement then
			local delta = input.Position - dragStart
			main.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + delta.X, startPos.Y.Scale, startPos.Y.Offset + delta.Y)
		end
	end)
	
	-- ============================================
	-- CHARACTER EVENTS
	-- ============================================
	player.CharacterAdded:Connect(function(char)
		task.wait(0.5)
		local hum = char:FindFirstChildOfClass("Humanoid")
		if hum then
			if Movement.walkSpeedEnabled then hum.WalkSpeed = Movement.walkSpeedValue end
			if Movement.jumpPowerEnabled then hum.JumpPower = Movement.jumpPowerValue end
		end
		if ESPState.Chams then updateChams() end
	end)
	
	Players.PlayerAdded:Connect(function()
		task.wait(1)
		if ESPState.Chams then updateChams() end
	end)
	
	print("[SimpleHub] Loaded with ALL features!")
	print("[SimpleHub] Press M to toggle menu")
end
